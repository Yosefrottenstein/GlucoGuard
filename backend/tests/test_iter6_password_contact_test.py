# Iteration 6: change-password endpoint and single-contact emergency test (phone/channel query)
import os
import uuid

import pytest
import requests


def _env(path, key):
    with open(path) as f:
        for line in f:
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError(f"{key} not configured")


BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or _env("/app/frontend/.env", "EXPO_PUBLIC_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"
DEMO_PW = "demo12345"


def login(u, p):
    return requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=20)


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def tmp_user():
    # throwaway user so demo_user's password is never at risk mid-suite
    u = f"TEST_it6_{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/auth/register", json={"username": u, "password": "origpass123", "name": "Test User"}, timeout=20)
    assert r.status_code in (200, 201), r.text
    return {"username": u, "password": "origpass123", "token": r.json()["access_token"]}


# --- change password ---
class TestChangePassword:
    def test_no_token_401(self):
        r = requests.post(f"{API}/auth/change-password", json={"current_password": "x", "new_password": "abcdefgh"})
        assert r.status_code == 401

    def test_wrong_current_400(self, tmp_user):
        r = requests.post(f"{API}/auth/change-password", headers=hdr(tmp_user["token"]),
                          json={"current_password": "wrongpass99", "new_password": "newpass1234"})
        assert r.status_code == 400
        assert r.json()["detail"] == "Current password is incorrect"

    def test_same_password_400(self, tmp_user):
        r = requests.post(f"{API}/auth/change-password", headers=hdr(tmp_user["token"]),
                          json={"current_password": tmp_user["password"], "new_password": tmp_user["password"]})
        assert r.status_code == 400
        assert "different" in r.json()["detail"].lower()

    def test_short_new_422(self, tmp_user):
        r = requests.post(f"{API}/auth/change-password", headers=hdr(tmp_user["token"]),
                          json={"current_password": tmp_user["password"], "new_password": "short"})
        assert r.status_code == 422

    def test_missing_fields_422(self, tmp_user):
        r = requests.post(f"{API}/auth/change-password", headers=hdr(tmp_user["token"]), json={})
        assert r.status_code == 422

    def test_success_and_relogin(self, tmp_user):
        r = requests.post(f"{API}/auth/change-password", headers=hdr(tmp_user["token"]),
                          json={"current_password": tmp_user["password"], "new_password": "brandnew5678"})
        assert r.status_code == 200 and r.json() == {"ok": True}
        assert login(tmp_user["username"], tmp_user["password"]).status_code == 401
        r2 = login(tmp_user["username"], "brandnew5678")
        assert r2.status_code == 200 and r2.json()["access_token"]
        tmp_user["password"] = "brandnew5678"

    def test_demo_user_roundtrip(self):
        r = login("demo_user", DEMO_PW)
        assert r.status_code == 200, r.text
        t = r.json()["access_token"]
        r = requests.post(f"{API}/auth/change-password", headers=hdr(t),
                          json={"current_password": DEMO_PW, "new_password": "TEST_tmp_pw_99"})
        try:
            assert r.status_code == 200 and r.json()["ok"] is True
            assert login("demo_user", DEMO_PW).status_code == 401
            assert login("demo_user", "TEST_tmp_pw_99").status_code == 200
        finally:
            if r.status_code == 200:
                back = requests.post(f"{API}/auth/change-password", headers=hdr(t),
                                     json={"current_password": "TEST_tmp_pw_99", "new_password": DEMO_PW})
                assert back.status_code == 200
        assert login("demo_user", DEMO_PW).status_code == 200


# --- per-contact emergency test ---
PHONE_C = {"name": "TEST_Phone", "phone": "+447700900333", "sms_via": "phone",
           "sms": {"enabled": True, "mode": "always", "windows": [], "repeat_minutes": 5},
           "call": {"enabled": True, "mode": "always", "windows": [], "repeat_minutes": 5}}
CLOUD_C = {"name": "TEST_Cloud", "phone": "+447700900444", "sms_via": "cloud",
           "sms": {"enabled": True, "mode": "always", "windows": [], "repeat_minutes": 5},
           "call": {"enabled": True, "mode": "always", "windows": [], "repeat_minutes": 5}}


@pytest.fixture(scope="module")
def em_user():
    u = f"TEST_it6e_{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/auth/register", json={"username": u, "password": "origpass123", "name": "Test User"}, timeout=20)
    t = r.json()["access_token"]
    r = requests.put(f"{API}/settings", headers=hdr(t), json={"em_contacts": [PHONE_C, CLOUD_C]})
    assert r.status_code == 200, r.text
    return t


class TestEmergencySingle:
    def test_unknown_phone_404(self, em_user):
        r = requests.post(f"{API}/emergency/test", headers=hdr(em_user), params={"phone": "+19999999999", "channel": "sms"})
        assert r.status_code == 404
        assert r.json()["detail"] == "Save this contact first, then send a test."

    def test_unencoded_plus_404(self, em_user):
        # raw '+' in query becomes a space -> no match (frontend must encode)
        r = requests.post(f"{API}/emergency/test?phone=+447700900333&channel=sms", headers=hdr(em_user))
        assert r.status_code == 404

    def test_bad_channel_422(self, em_user):
        r = requests.post(f"{API}/emergency/test", headers=hdr(em_user), params={"phone": PHONE_C["phone"], "channel": "fax"})
        assert r.status_code == 422

    def test_phone_contact_sms_only(self, em_user):
        r = requests.post(f"{API}/emergency/test", headers=hdr(em_user), params={"phone": PHONE_C["phone"], "channel": "sms"})
        assert r.status_code == 200, r.text
        res = r.json()["results"]
        assert res == ["Text to TEST_Phone handed to your phone"], res

    def test_phone_contact_call_only(self, em_user):
        r = requests.post(f"{API}/emergency/test", headers=hdr(em_user), params={"phone": PHONE_C["phone"], "channel": "call"})
        # contact is sms_via=phone (not all cloud) so no 400; call fails for missing keys
        assert r.status_code == 200, r.text
        res = r.json()["results"]
        assert res == ["Call to TEST_Phone failed: add your Twilio account first"], res

    def test_phone_contact_both(self, em_user):
        r = requests.post(f"{API}/emergency/test", headers=hdr(em_user), params={"phone": PHONE_C["phone"]})
        assert r.status_code == 200
        res = r.json()["results"]
        assert any("handed to your phone" in x for x in res) and any("Call to TEST_Phone" in x for x in res)
        assert not any("TEST_Cloud" in x for x in res)

    def test_cloud_contact_400(self, em_user):
        r = requests.post(f"{API}/emergency/test", headers=hdr(em_user), params={"phone": CLOUD_C["phone"], "channel": "sms"})
        assert r.status_code == 400
        assert "twilio account" in r.json()["detail"].lower()

    def test_all_contacts_unchanged(self, em_user):
        r = requests.post(f"{API}/emergency/test", headers=hdr(em_user))
        assert r.status_code == 200, r.text
        res = r.json()["results"]
        assert any("TEST_Phone" in x for x in res) and any("TEST_Cloud" in x for x in res)

    def test_no_token_401(self):
        r = requests.post(f"{API}/emergency/test", params={"phone": PHONE_C["phone"]})
        assert r.status_code == 401
