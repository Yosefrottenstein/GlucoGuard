# Iteration 5: per-contact SMS/call settings (no global em_sms/em_call), legacy migration, outbox expiry, dexcom demo guard
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient


def _env(path, key):
    with open(path) as f:
        for line in f:
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError(f"{key} not configured")


BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or _env("/app/frontend/.env", "EXPO_PUBLIC_BACKEND_URL")).rstrip("/")
MDB = MongoClient(_env("/app/backend/.env", "MONGO_URL"))[_env("/app/backend/.env", "DB_NAME")]
LEGACY = ("em_sms", "em_call", "em_sms_via", "em_sms_schedule", "em_call_schedule",
          "em_sms_repeat_minutes", "em_call_repeat_minutes")

A = {"name": "TEST_Mum", "phone": "+447700900111", "sms_via": "phone",
     "sms": {"enabled": True, "mode": "always", "windows": [], "repeat_minutes": 5},
     "call": {"enabled": False, "mode": "always", "windows": [], "repeat_minutes": 5}}
# call window on no day that matches "now" is impossible to guarantee, so use a 1-minute window far from now
B = {"name": "TEST_Dad", "phone": "+447700900222", "sms_via": "cloud",
     "sms": {"enabled": False, "mode": "always", "windows": [], "repeat_minutes": 3},
     "call": {"enabled": True, "mode": "hours", "windows": [{"days": [0, 1, 2, 3, 4], "start": "22:00", "end": "07:00"}],
              "repeat_minutes": 10}}


def _outside_window():
    # a 1 minute window 12 h away from now (UTC) on every day
    h = (datetime.now(timezone.utc).hour + 12) % 24
    return {"days": [0, 1, 2, 3, 4, 5, 6], "start": f"{h:02d}:00", "end": f"{h:02d}:01"}


def _new_user(prefix):
    s = requests.Session()
    creds = {"username": f"TEST_{prefix}_{uuid.uuid4().hex[:8]}", "password": "testpass123", "name": "Test User"}
    r = s.post(f"{BASE_URL}/api/auth/register", json=creds)
    assert r.status_code in (200, 201), r.text
    tok = r.json().get("access_token") or s.post(f"{BASE_URL}/api/auth/login", json=creds).json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    s.uid = s.get(f"{BASE_URL}/api/auth/me").json()["id"]
    return s


@pytest.fixture(scope="module")
def api():
    return _new_user("it5")


def put(api, patch):
    return api.put(f"{BASE_URL}/api/settings", json=patch)


# --- settings shape ---
class TestShape:
    def test_no_global_channel_keys(self, api):
        d = api.get(f"{BASE_URL}/api/settings").json()
        for k in LEGACY:
            assert k not in d, k
        assert d["em_contacts"] == []

    def test_two_contacts_persist_independently(self, api):
        r = put(api, {"em_contacts": [A, B]})
        assert r.status_code == 200, r.text
        got = api.get(f"{BASE_URL}/api/settings").json()["em_contacts"]
        assert len(got) == 2
        assert got[0]["sms_via"] == "phone" and got[0]["sms"]["repeat_minutes"] == 5 and got[0]["call"]["enabled"] is False
        assert got[1]["sms_via"] == "cloud" and got[1]["sms"]["enabled"] is False
        assert got[1]["call"]["mode"] == "hours" and got[1]["call"]["repeat_minutes"] == 10
        assert got[1]["call"]["windows"][0] == {"days": [0, 1, 2, 3, 4], "start": "22:00", "end": "07:00"}

    @pytest.mark.parametrize("rep", [0, 721])
    def test_repeat_out_of_range_422(self, api, rep):
        bad = {**A, "sms": {**A["sms"], "repeat_minutes": rep}}
        assert put(api, {"em_contacts": [bad]}).status_code == 422

    def test_legacy_keys_in_patch_ignored(self, api):
        r = put(api, {"em_sms": False, "em_sms_repeat_minutes": 9})
        assert r.status_code == 200
        assert "em_sms" not in r.json()


# --- legacy doc migration ---
class TestMigration:
    def test_legacy_doc_migrates_and_unsets(self):
        u = _new_user("it5mig")
        MDB.settings.update_one({"_id": u.uid}, {"$set": {
            "em_sms": True, "em_call": False, "em_sms_via": "phone",
            "em_sms_schedule": {"enabled": True, "mode": "hours", "windows": [{"days": [5, 6], "start": "08:00", "end": "20:00"}]},
            "em_call_schedule": {"enabled": True, "mode": "hours", "start": "00:00", "end": "07:00"},
            "em_sms_repeat_minutes": 7, "em_call_repeat_minutes": 11,
            "em_contacts": [{"name": "TEST_Old", "phone": "+447700900333",
                             "sms": {"enabled": True, "mode": "default"}, "call": {"enabled": True, "mode": "always"}}]}},
            upsert=True)
        c = u.get(f"{BASE_URL}/api/settings").json()["em_contacts"][0]
        assert c["sms_via"] == "phone"
        assert c["sms"]["mode"] == "hours" and c["sms"]["windows"][0]["days"] == [5, 6] and c["sms"]["repeat_minutes"] == 7
        assert c["call"]["mode"] == "always"  # own non-default mode kept
        assert c["call"]["enabled"] is False  # global em_call False copied
        assert c["call"]["repeat_minutes"] == 11
        assert put(u, {"em_name": "TEST_x"}).status_code == 200
        doc = MDB.settings.find_one({"_id": u.uid})
        for k in LEGACY:
            assert k not in doc, k


# --- emergency test results per contact ---
class TestEmergency:
    def test_results_per_contact(self, api):
        b = {**B, "call": {**B["call"], "windows": [_outside_window()]}}
        c = {"name": "TEST_Sis", "phone": "+447700900444", "sms_via": "cloud",
             "sms": {"enabled": False}, "call": {"enabled": True, "mode": "always"}}
        assert put(api, {"em_contacts": [A, b, c], "tz": "UTC"}).status_code == 200
        r = api.post(f"{BASE_URL}/api/emergency/test")
        assert r.status_code == 200, r.text
        res = r.json()["results"]
        assert "Text to TEST_Mum handed to your phone" in res
        assert not any("call" in x.lower() and "TEST_Mum" in x for x in res)  # disabled channel -> no line
        assert "No call to TEST_Dad (outside the set hours)" in res
        assert not any("text" in x.lower() and "TEST_Dad" in x for x in res)
        assert "Call to TEST_Sis failed: add your Twilio account first" in res
        box = api.get(f"{BASE_URL}/api/sms/outbox").json()
        assert any(i["to"] == A["phone"] and i["body"].startswith("TEST") for i in box)

    def test_all_cloud_400(self, api):
        c = {"name": "TEST_Sis", "phone": "+447700900444", "sms_via": "cloud", "sms": {"enabled": True}}
        assert put(api, {"em_contacts": [c]}).status_code == 200
        r = api.post(f"{BASE_URL}/api/emergency/test")
        assert r.status_code == 400 and "Twilio" in r.json()["detail"]

    def test_outbox_expiry_logged(self, api):
        MDB.sms_outbox.insert_one({"to": "+447700900999", "name": "TEST_Expired", "body": "TEST - old",
                                   "ts": datetime.now(timezone.utc) - timedelta(minutes=40), "status": "pending", "uid": api.uid})
        box = api.get(f"{BASE_URL}/api/sms/outbox").json()
        assert not any(i["name"] == "TEST_Expired" for i in box)
        assert MDB.sms_outbox.find_one({"uid": api.uid, "name": "TEST_Expired"})["status"] == "expired"
        log = api.get(f"{BASE_URL}/api/emergency/log").json()
        assert any("TEST_Expired not sent: your phone didn't pick it up" in r for e in log for r in e["results"])


# --- check_alarms per contact resend ---
class TestResend:
    def test_resend_per_contact_channel(self):
        u = _new_user("it5alarm")
        a = {**A, "sms": {**A["sms"], "repeat_minutes": 1}}
        d = {**A, "name": "TEST_Bro", "phone": "+447700900555", "sms": {**A["sms"], "repeat_minutes": 60}}
        r = put(u, {"source": "manual", "em_enabled": True, "em_delay_minutes": 0, "em_triggers": ["urgent_low"],
                    "em_contacts": [a, d]})
        assert r.status_code == 200, r.text
        assert u.post(f"{BASE_URL}/api/readings", json={"sgv": 45}).status_code in (200, 201)
        time.sleep(3)
        st = MDB.state.find_one({"_id": f"alarm:{u.uid}"}) or {}
        sent = st.get("em_sent") or {}
        assert f"{a['phone']}|sms" in sent and f"{d['phone']}|sms" in sent, st
        assert f"{a['phone']}|call" not in sent  # disabled channel
        n1 = MDB.sms_outbox.count_documents({"uid": u.uid})
        assert n1 == 2
        # age both timestamps by 2 minutes: only the 1-minute contact is due again
        old = datetime.now(timezone.utc) - timedelta(minutes=2)
        MDB.state.update_one({"_id": f"alarm:{u.uid}"}, {"$set": {f"em_sent.{a['phone']}|sms": old,
                                                                    f"em_sent.{d['phone']}|sms": old}})
        u.post(f"{BASE_URL}/api/readings", json={"sgv": 44})
        time.sleep(3)
        docs = list(MDB.sms_outbox.find({"uid": u.uid}))
        assert sum(1 for x in docs if x["to"] == a["phone"]) == 2
        assert sum(1 for x in docs if x["to"] == d["phone"]) == 1


# --- dexcom upload demo guard ---
class TestDexcom:
    def test_demo_upload_400(self):
        u = _new_user("it5dx")
        assert put(u, {"dexcom_username": "TEST_u", "dexcom_password": "TEST_p", "source": "demo"}).status_code == 200
        r = u.post(f"{BASE_URL}/api/dexcom/upload")
        assert r.status_code == 400 and "Demo" in r.json()["detail"]

    def test_no_creds_400_first(self):
        u = _new_user("it5dx2")
        r = u.post(f"{BASE_URL}/api/dexcom/upload")
        assert r.status_code == 400 and "Dexcom username" in r.json()["detail"]
