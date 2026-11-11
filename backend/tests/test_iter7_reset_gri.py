# Iteration 7: username rules, recovery email, forgot/reset password, GRI + non-overlapping TIR bands
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import pytest
import requests
from bson import ObjectId
from dotenv import dotenv_values
from pymongo import MongoClient

FE_ENV = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or FE_ENV.get("EXPO_PUBLIC_BACKEND_URL")).rstrip("/")
BE_ENV = dotenv_values("/app/backend/.env")
mdb = MongoClient(BE_ENV["MONGO_URL"])[BE_ENV["DB_NAME"]]
API = f"{BASE_URL}/api"
CREATED = []


def _register(username, password="password1"):
    r = requests.post(f"{API}/auth/register", json={"username": username, "password": password}, timeout=30)
    if r.status_code == 201:
        CREATED.append(username)
    return r


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    for u in CREATED:
        doc = mdb.users.find_one({"username": u})
        if doc:
            uid = str(doc["_id"])
            for c in ("readings", "treatments", "summaries", "emergency_log"):
                mdb[c].delete_many({"uid": uid})
            mdb.settings.delete_one({"_id": uid})
            mdb.password_resets.delete_one({"_id": doc["_id"]})
            mdb.users.delete_one({"_id": doc["_id"]})


@pytest.fixture(scope="module")
def user():
    name = f"TEST_r{uuid.uuid4().hex[:8]}"
    r = _register(name)
    assert r.status_code == 201, r.text
    return {"username": name, "token": r.json()["access_token"]}


# --- Registration username rules
class TestRegister:
    def test_space_rejected(self):
        r = _register("abc de")
        assert r.status_code == 422
        assert "space" in r.text.lower()

    def test_short_rejected(self):
        r = _register("abcd")
        assert r.status_code == 422
        assert "5" in r.text

    def test_valid_201(self, user):
        assert user["token"]

    def test_short_existing_login_allowed(self):
        # Credentials model accepts any length; 'abc' unknown -> 401 not 422
        r = requests.post(f"{API}/auth/login", json={"username": "abc", "password": "x"}, timeout=30)
        assert r.status_code == 401

    def test_demo_login(self):
        r = requests.post(f"{API}/auth/login", json={"username": "demo_user", "password": "demo12345"}, timeout=30)
        assert r.status_code == 200 and r.json()["access_token"]


# --- /auth/me and /auth/email
class TestEmail:
    def test_me_requires_auth(self):
        assert requests.get(f"{API}/auth/me", timeout=30).status_code == 401
        assert requests.put(f"{API}/auth/email", json={"email": "a@b.co"}, timeout=30).status_code == 401

    def test_me_no_email(self, user):
        r = requests.get(f"{API}/auth/me", headers=_h(user["token"]), timeout=30)
        assert r.status_code == 200
        assert r.json()["username"] == user["username"] and r.json().get("email") is None

    def test_invalid_email(self, user):
        r = requests.put(f"{API}/auth/email", json={"email": "not-an-email"}, headers=_h(user["token"]), timeout=30)
        assert r.status_code == 422

    def test_valid_email_lowercased(self, user):
        r = requests.put(f"{API}/auth/email", json={"email": "  Delivered@Resend.DEV "}, headers=_h(user["token"]), timeout=30)
        assert r.status_code == 200 and r.json()["email"] == "delivered@resend.dev"
        me = requests.get(f"{API}/auth/me", headers=_h(user["token"]), timeout=30).json()
        assert me["email"] == "delivered@resend.dev"


# --- forgot + reset
class TestForgotReset:
    def test_unknown_user_generic(self):
        r = requests.post(f"{API}/auth/forgot", json={"username": f"nouser{uuid.uuid4().hex[:6]}"}, timeout=30)
        assert r.status_code == 200 and r.json()["ok"] is True

    def test_user_without_email_generic(self):
        name = f"TEST_n{uuid.uuid4().hex[:8]}"
        assert _register(name).status_code == 201
        r = requests.post(f"{API}/auth/forgot", json={"username": name}, timeout=30)
        assert r.status_code == 200 and "6-digit" in r.json()["message"]
        assert mdb.password_resets.find_one({"_id": mdb.users.find_one({"username": name})["_id"]}) is None

    def test_send_then_429(self, user):
        r = requests.post(f"{API}/auth/forgot", json={"username": user["username"]}, timeout=60)
        assert r.status_code == 200, r.text
        doc = mdb.password_resets.find_one({"_id": mdb.users.find_one({"username": user["username"]})["_id"]})
        assert doc and doc["attempts"] == 0 and doc["code_hash"].startswith("$2")
        r2 = requests.post(f"{API}/auth/forgot", json={"username": user["username"].upper()}, timeout=30)
        assert r2.status_code == 429

    def test_wrong_code_then_lock(self, user):
        oid = mdb.users.find_one({"username": user["username"]})["_id"]
        known = "123456"
        mdb.password_resets.update_one({"_id": oid}, {"$set": {
            "code_hash": bcrypt.hashpw(known.encode(), bcrypt.gensalt()).decode(), "attempts": 0,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10)}})
        body = {"username": user["username"], "code": "000000", "new_password": "newpass123"}
        for i in range(5):
            r = requests.post(f"{API}/auth/reset", json=body, timeout=30)
            assert r.status_code == 400
            assert mdb.password_resets.find_one({"_id": oid})["attempts"] == i + 1
        # locked: even correct code fails
        r = requests.post(f"{API}/auth/reset", json={**body, "code": known}, timeout=30)
        assert r.status_code == 400

    def test_bad_code_format_422(self, user):
        r = requests.post(f"{API}/auth/reset", json={"username": user["username"], "code": "12ab", "new_password": "newpass123"}, timeout=30)
        assert r.status_code == 422

    def test_correct_code_resets(self, user):
        oid = mdb.users.find_one({"username": user["username"]})["_id"]
        known = "654321"
        mdb.password_resets.update_one({"_id": oid}, {"$set": {
            "code_hash": bcrypt.hashpw(known.encode(), bcrypt.gensalt()).decode(), "attempts": 0,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10)}})
        r = requests.post(f"{API}/auth/reset", json={"username": user["username"], "code": known, "new_password": "newpass123"}, timeout=30)
        assert r.status_code == 200, r.text
        tok = r.json()["access_token"]
        assert requests.get(f"{API}/auth/me", headers=_h(tok), timeout=30).status_code == 200
        assert mdb.password_resets.find_one({"_id": oid}) is None
        ok = requests.post(f"{API}/auth/login", json={"username": user["username"], "password": "newpass123"}, timeout=30)
        assert ok.status_code == 200
        old = requests.post(f"{API}/auth/login", json={"username": user["username"], "password": "password1"}, timeout=30)
        assert old.status_code == 401

    def test_expired_code_rejected(self, user):
        oid = mdb.users.find_one({"username": user["username"]})["_id"]
        mdb.password_resets.insert_one({"_id": oid, "code_hash": bcrypt.hashpw(b"111111", bcrypt.gensalt()).decode(),
                                        "attempts": 0, "sent_at": datetime.now(timezone.utc),
                                        "expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)})
        r = requests.post(f"{API}/auth/reset", json={"username": user["username"], "code": "111111", "new_password": "another123"}, timeout=30)
        assert r.status_code == 400
        mdb.password_resets.delete_one({"_id": oid})


def _expected(vals, tl, th):
    n = len(vals)
    p = lambda f: 100 * sum(f(v) for v in vals) / n  # noqa: E731
    gri = min(100.0, 3.0 * p(lambda v: v < 54) + 2.4 * p(lambda v: 54 <= v <= 69)
              + 1.6 * p(lambda v: v > 250) + 0.8 * p(lambda v: 181 <= v <= 250))
    return gri


# --- Stats: GRI + bands
class TestStats:
    @pytest.fixture(scope="class")
    def seeded(self, user):
        tok = requests.post(f"{API}/auth/login", json={"username": user["username"], "password": "newpass123"}, timeout=30)
        tok = tok.json()["access_token"] if tok.status_code == 200 else user["token"]
        requests.post(f"{API}/sync", headers=_h(tok), timeout=60)
        uid = str(mdb.users.find_one({"username": user["username"]})["_id"])
        if mdb.readings.count_documents({"uid": uid}) < 20:
            now = datetime.now(timezone.utc)
            seq = [45, 50, 60, 65, 100, 120, 150, 190, 220, 260, 300, 110, 95, 80, 175, 181, 250, 251, 53, 54]
            mdb.readings.insert_many([{"uid": uid, "ts": now - timedelta(minutes=5 * i), "sgv": v} for i, v in enumerate(seq)])
        return tok, uid

    def _stats(self, tok, start):
        return requests.get(f"{API}/stats", params={"start": start.isoformat()}, headers=_h(tok), timeout=30)

    def test_gri_formula(self, seeded):
        tok, uid = seeded
        start = datetime.now(timezone.utc) - timedelta(hours=24)
        r = self._stats(tok, start)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["count"] > 0
        vals = [x["sgv"] for x in mdb.readings.find({"uid": uid, "ts": {"$gte": start}})]
        exp = _expected(vals, 70, 180)
        assert abs(d["gri"]["value"] - round(exp)) <= 1, (d["gri"], exp)
        assert d["gri"]["zone"] in "ABCDE"
        zone = "ABCDE"[min(4, int(max(d["gri"]["value"] - 0.001, 0) // 20))]
        assert d["gri"]["zone"] == zone
        assert set(d["gri"]) >= {"value", "zone", "hypo", "hyper"}
        assert abs(sum(d["tir"].values()) - 100) <= 0.6
        print("GRI", d["gri"], "bands", d["bands"], "tir", d["tir"])

    def test_bands_target_low_50(self, seeded):
        tok, uid = seeded
        r = requests.put(f"{API}/settings", json={"target_low": 50, "target_high": 260}, headers=_h(tok), timeout=30)
        assert r.status_code == 200, r.text
        d = self._stats(tok, datetime.now(timezone.utc) - timedelta(hours=24)).json()
        assert d["bands"] == {"low": 54, "high": 250}
        assert d["tir"]["low"] == 0 and d["tir"]["high"] == 0
        assert abs(sum(d["tir"].values()) - 100) <= 0.6
        print("bands50", d["bands"], d["tir"])

    def test_bands_target_low_above_250(self, seeded):
        # edge: target_low 260 / target_high 300 is accepted by settings validation
        tok, uid = seeded
        r = requests.put(f"{API}/settings", json={"target_low": 260, "target_high": 300}, headers=_h(tok), timeout=30)
        assert r.status_code == 200, r.text
        d = self._stats(tok, datetime.now(timezone.utc) - timedelta(hours=24)).json()
        print("bands260", d["bands"], d["tir"], sum(d["tir"].values()))
        assert abs(sum(d["tir"].values()) - 100) <= 0.6
