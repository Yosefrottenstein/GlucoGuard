"""Iteration 3: auth + per-user data isolation tests.

Covers:
- POST /api/auth/register: 201 shape, 409 duplicate (case-insensitive), 422 validation
- POST /api/auth/login: 200 with token, 401 wrong creds, GET /api/auth/me
- Protected endpoints without token -> 401
- Two-user data isolation (settings + treatments)
- Fresh user sync -> /api/status returns a demo reading
"""
import os
import secrets
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests


def _base_url() -> str:
    env = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if env:
        return env.rstrip("/")
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not configured")


BASE_URL = _base_url()


def _rand(prefix="TEST"):
    return f"{prefix}_{secrets.token_hex(4)}"


@pytest.fixture(scope="module")
def raw():
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    return s


# ---------------- Register ----------------
class TestRegister:
    def test_register_success(self, raw):
        uname = _rand("TEST_reg")
        r = raw.post(f"{BASE_URL}/api/auth/register", json={"username": uname, "password": "pw12345678", "name": "Test User"})
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["username"] == uname
        assert isinstance(data["access_token"], str) and len(data["access_token"]) > 20

    def test_register_duplicate_case_insensitive(self, raw):
        uname = _rand("TEST_dup")
        r1 = raw.post(f"{BASE_URL}/api/auth/register", json={"username": uname, "password": "pw12345678", "name": "Test User"})
        assert r1.status_code == 201
        r2 = raw.post(f"{BASE_URL}/api/auth/register", json={"username": uname.upper(), "password": "pw12345678", "name": "Test User"})
        assert r2.status_code == 409, r2.text

    def test_register_short_username(self, raw):
        r = raw.post(f"{BASE_URL}/api/auth/register", json={"username": "ab", "password": "pw12345678"})
        assert r.status_code == 422

    def test_register_short_password(self, raw):
        r = raw.post(f"{BASE_URL}/api/auth/register", json={"username": _rand("TEST_shortpw"), "password": "short"})
        assert r.status_code == 422


# ---------------- Login + /me ----------------
class TestLogin:
    @pytest.fixture(scope="class")
    def creds(self, raw):
        uname = _rand("TEST_login")
        pw = "pw12345678"
        r = raw.post(f"{BASE_URL}/api/auth/register", json={"username": uname, "password": pw, "name": "Test User"})
        assert r.status_code == 201
        return {"username": uname, "password": pw, "user_id": None}

    def test_login_success(self, raw, creds):
        r = raw.post(f"{BASE_URL}/api/auth/login", json={"username": creds["username"], "password": creds["password"]})
        assert r.status_code == 200, r.text
        tok = r.json()["access_token"]
        assert tok
        # /me with token
        me = raw.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert me.status_code == 200
        me_data = me.json()
        assert me_data["username"] == creds["username"]
        assert isinstance(me_data["id"], str) and len(me_data["id"]) > 0

    def test_login_wrong_password(self, raw, creds):
        r = raw.post(f"{BASE_URL}/api/auth/login", json={"username": creds["username"], "password": "WRONG_pw9999"})
        assert r.status_code == 401
        assert "wrong" in r.json()["detail"].lower()

    def test_login_unknown_user(self, raw):
        r = raw.post(f"{BASE_URL}/api/auth/login", json={"username": _rand("TEST_nouser"), "password": "pw12345678"})
        assert r.status_code == 401

    def test_me_without_token(self, raw):
        r = raw.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401


# ---------------- Protected endpoints require token ----------------
class TestProtected:
    @pytest.mark.parametrize("path,method", [
        ("/api/status", "GET"),
        ("/api/settings", "GET"),
        ("/api/readings?start=2026-01-01T00:00:00Z", "GET"),
        ("/api/treatments?start=2026-01-01T00:00:00Z", "GET"),
        ("/api/stats?start=2026-01-01T00:00:00Z", "GET"),
    ])
    def test_requires_bearer(self, raw, path, method):
        r = raw.request(method, f"{BASE_URL}{path}")
        assert r.status_code == 401, f"{path}: {r.status_code} {r.text[:120]}"

    def test_invalid_token_rejected(self, raw):
        r = raw.get(f"{BASE_URL}/api/status", headers={"Authorization": "Bearer not.a.jwt"})
        assert r.status_code == 401


# ---------------- Data isolation ----------------
def _register(raw, prefix):
    uname = _rand(prefix)
    r = raw.post(f"{BASE_URL}/api/auth/register", json={"username": uname, "password": "pw12345678", "name": "Test User"})
    assert r.status_code == 201, r.text
    return uname, r.json()["access_token"]


class TestDataIsolation:
    def test_user_a_data_not_visible_to_user_b(self, raw):
        _, tok_a = _register(raw, "TEST_iso_a")
        _, tok_b = _register(raw, "TEST_iso_b")
        hdr_a = {"Authorization": f"Bearer {tok_a}"}
        hdr_b = {"Authorization": f"Bearer {tok_b}"}

        # A: change unit to mmol
        r = raw.put(f"{BASE_URL}/api/settings", json={"unit": "mmol"}, headers=hdr_a)
        assert r.status_code == 200, r.text
        assert r.json()["unit"] == "mmol"

        # A: create a treatment
        r = raw.post(f"{BASE_URL}/api/treatments",
                     json={"kind": "carbs", "carbs": 42, "note": "TEST_iso_a_meal"},
                     headers=hdr_a)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]

        # A sees own treatment
        start = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        la = raw.get(f"{BASE_URL}/api/treatments", params={"start": start}, headers=hdr_a)
        assert la.status_code == 200
        assert any(t["id"] == tid for t in la.json())

        # B: unit remains default (mgdl), does NOT see A's treatment
        sb = raw.get(f"{BASE_URL}/api/settings", headers=hdr_b)
        assert sb.status_code == 200
        assert sb.json()["unit"] == "mgdl", "B's settings must not reflect A's unit change"

        lb = raw.get(f"{BASE_URL}/api/treatments", params={"start": start}, headers=hdr_b)
        assert lb.status_code == 200
        assert not any(t["id"] == tid for t in lb.json()), "B must not see A's treatment"

        # B tries to delete A's treatment -> 404
        d = raw.delete(f"{BASE_URL}/api/treatments/{tid}", headers=hdr_b)
        assert d.status_code == 404, d.text

        # A can still delete own treatment
        d2 = raw.delete(f"{BASE_URL}/api/treatments/{tid}", headers=hdr_a)
        assert d2.status_code == 200


# ---------------- Fresh user sync produces a reading ----------------
class TestFreshUserSync:
    def test_sync_backfills_demo(self, raw):
        _, tok = _register(raw, "TEST_sync")
        hdr = {"Authorization": f"Bearer {tok}"}
        r = raw.post(f"{BASE_URL}/api/sync", headers=hdr)
        assert r.status_code == 200, r.text
        # Wait briefly in case insert is still finishing
        reading = None
        for _ in range(10):
            st = raw.get(f"{BASE_URL}/api/status", headers=hdr)
            assert st.status_code == 200
            reading = st.json().get("reading")
            if reading:
                break
            time.sleep(0.5)
        assert reading is not None, "Expected a demo reading after /api/sync"
        assert reading.get("source") == "demo"
        assert isinstance(reading.get("sgv"), int)
