# Iteration 10: register with name (em_name), name validation, emergency text uses name, batch source 'health'
import os
import time
from datetime import datetime

import pytest
import requests
from bson import ObjectId
from dotenv import dotenv_values
from pymongo import MongoClient

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or dotenv_values("/app/frontend/.env")["EXPO_PUBLIC_BACKEND_URL"]).rstrip("/")
API = f"{BASE_URL}/api"
ENV = dotenv_values("/app/backend/.env")
mdb = MongoClient(ENV["MONGO_URL"])[ENV["DB_NAME"]]

UNAME = f"TEST_anna{int(time.time()) % 100000}"
created_uids = []


def _cleanup(uid):
    for c in ("readings", "settings", "state", "emergency_log", "sms_outbox", "treatments", "alarm_log", "login_attempts"):
        if c == "settings":
            mdb.settings.delete_one({"_id": uid})
        else:
            mdb[c].delete_many({"uid": uid})
    mdb.users.delete_one({"_id": ObjectId(uid)})


@pytest.fixture(scope="module")
def anna():
    r = requests.post(f"{API}/auth/register", json={"username": UNAME, "password": "password1", "name": "  Anna   Test "})
    assert r.status_code in (200, 201), r.text
    tok = r.json()["access_token"]
    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {tok}"
    uid = str(mdb.users.find_one({"username": UNAME})["_id"])
    created_uids.append(uid)
    yield sess, uid
    for u in created_uids:
        _cleanup(u)


# Registration with name
class TestRegisterName:
    def test_register_sets_em_name(self, anna):
        sess, _ = anna
        d = sess.get(f"{API}/settings").json()
        assert d["em_name"] == "Anna Test"

    def test_me(self, anna):
        sess, _ = anna
        d = sess.get(f"{API}/auth/me").json()
        assert d["username"] == UNAME and d["email"] is None

    def test_short_name_422(self):
        r = requests.post(f"{API}/auth/register", json={"username": UNAME + "x", "password": "password1", "name": "Al"})
        assert r.status_code == 422, r.text
        assert mdb.users.find_one({"username": UNAME + "x"}) is None

    def test_missing_name_422(self):
        r = requests.post(f"{API}/auth/register", json={"username": UNAME + "y", "password": "password1"})
        if r.status_code in (200, 201):
            created_uids.append(str(mdb.users.find_one({"username": UNAME + "y"})["_id"]))
        assert r.status_code == 422, r.text

    def test_whitespace_name_422(self):
        r = requests.post(f"{API}/auth/register", json={"username": UNAME + "z", "password": "password1", "name": "  A  "})
        assert r.status_code == 422, r.text

    def test_name_too_long_422(self):
        r = requests.post(f"{API}/auth/register", json={"username": UNAME + "w", "password": "password1", "name": "A" * 41})
        assert r.status_code == 422, r.text

    def test_duplicate_username_409(self, anna):
        r = requests.post(f"{API}/auth/register", json={"username": UNAME, "password": "password1", "name": "Anna Test"})
        assert r.status_code == 409

    def test_update_name_via_settings(self, anna):
        sess, _ = anna
        r = sess.put(f"{API}/settings", json={"em_name": "Annabel"})
        assert r.status_code == 200 and r.json()["em_name"] == "Annabel"
        assert sess.get(f"{API}/settings").json()["em_name"] == "Annabel"
        sess.put(f"{API}/settings", json={"em_name": "Anna Test"})

    def test_settings_short_name_behaviour(self, anna):
        # informational: does backend enforce 3+ chars on PUT /settings too?
        sess, _ = anna
        r = sess.put(f"{API}/settings", json={"em_name": "Al"})
        print("PUT /settings em_name='Al' ->", r.status_code, r.text[:200])
        sess.put(f"{API}/settings", json={"em_name": "Anna Test"})


# Emergency test message uses the name
class TestEmergencyName:
    def test_emergency_text_uses_name(self, anna):
        sess, uid = anna
        r = sess.put(f"{API}/settings", json={"em_enabled": True, "em_contacts": [
            {"name": "TEST_Mom", "phone": "+15550001234", "sms_via": "phone", "call": {"enabled": False}}]})
        assert r.status_code == 200, r.text
        r = sess.post(f"{API}/emergency/test")
        print("emergency/test ->", r.status_code, r.text[:400])
        assert r.status_code in (200, 400), r.text
        out = list(mdb.sms_outbox.find({"uid": uid}))
        logs = list(mdb.emergency_log.find({"uid": uid}))
        bodies = [d["body"] for d in out] + [d.get("message", "") for d in logs]
        print("bodies:", bodies)
        assert bodies, "no message built"
        assert any("Anna Test's glucose" in b for b in bodies), bodies


# Readings batch with source 'health'
class TestBatchHealth:
    def test_health_source(self, anna):
        sess, uid = anna
        r = sess.post(f"{API}/readings/batch", json={"source": "health", "readings": [{"ts": "2026-01-10T03:02:17Z", "sgv": 111, "direction": "Flat"}]})
        assert r.status_code == 200, r.text
        assert r.json()["added"] == 1
        doc = mdb.readings.find_one({"uid": uid, "ts": datetime(2026, 1, 10, 3, 2, 17)})
        assert doc and doc["source"] == "health"

    def test_settings_source_health(self, anna):
        sess, _ = anna
        r = sess.put(f"{API}/settings", json={"source": "health"})
        print("PUT source=health ->", r.status_code, r.text[:200])
        assert r.status_code == 200 and r.json()["source"] == "health"


# demo_user still signs in
class TestDemo:
    def test_demo_login(self):
        r = requests.post(f"{API}/auth/login", json={"username": "demo_user", "password": "demo12345"})
        assert r.status_code == 200
        s = requests.get(f"{API}/settings", headers={"Authorization": f"Bearer {r.json()['access_token']}"}).json()
        print("demo em_name:", repr(s["em_name"]))
