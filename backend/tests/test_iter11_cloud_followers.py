# Iteration 11: follower sources twiist Insight, Medtronic CareLink, Omnipod DISCOVER (Glooko)
import base64
import os
import struct
import sys
import time
import zlib
from datetime import datetime, timedelta, timezone

import pytest
import requests
from bson import ObjectId
from dotenv import dotenv_values
from pymongo import MongoClient

sys.path.insert(0, "/app/backend")
import cloud_followers as cf  # noqa: E402

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or dotenv_values("/app/frontend/.env")["EXPO_PUBLIC_BACKEND_URL"]).rstrip("/")
API = f"{BASE_URL}/api"
ENV = dotenv_values("/app/backend/.env")
mdb = MongoClient(ENV["MONGO_URL"])[ENV["DB_NAME"]]
UNAME = f"TEST_cf{int(time.time()) % 1000000}"


def _cleanup(uid):
    for c in ("readings", "state", "emergency_log", "sms_outbox", "treatments", "alarm_log", "login_attempts"):
        mdb[c].delete_many({"uid": uid})
    mdb.settings.delete_one({"_id": uid})
    mdb.users.delete_one({"_id": ObjectId(uid)})


@pytest.fixture(scope="module")
def user():
    r = requests.post(f"{API}/auth/register", json={"username": UNAME, "password": "password1", "name": "Cloud Tester"})
    assert r.status_code in (200, 201), r.text
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    uid = str(mdb.users.find_one({"username": UNAME})["_id"])
    yield s, uid
    _cleanup(uid)


def _sync_error(s):
    r = s.post(f"{API}/sync", timeout=90)
    assert r.status_code == 200, r.text
    st = s.get(f"{API}/status").json()
    return r.json().get("error"), st.get("last_error"), st


# Settings: new fields and secret hiding
class TestSettingsFields:
    def test_twiist_saved_and_hidden(self, user):
        s, _ = user
        r = s.put(f"{API}/settings", json={"source": "twiist", "twiist_username": "TEST_fake@example.com", "twiist_password": "nopass123"})
        assert r.status_code == 200, r.text
        d = s.get(f"{API}/settings").json()
        assert d["source"] == "twiist" and d["twiist_username"] == "TEST_fake@example.com"
        assert d["twiist_password"] == "" and d["twiist_password_set"] is True

    def test_carelink_fields(self, user):
        s, _ = user
        r = s.put(f"{API}/settings", json={"cl_username": "TEST_cl", "cl_password": "x1", "cl_server": "US", "cl_country": "us", "cl_patient": "kid1"})
        assert r.status_code == 200, r.text
        d = s.get(f"{API}/settings").json()
        assert (d["cl_server"], d["cl_country"], d["cl_patient"], d["cl_username"]) == ("US", "us", "kid1", "TEST_cl")
        assert d["cl_password"] == "" and d["cl_password_set"] is True
        assert d["cl_refresh_token"] == "" and d["cl_refresh_token_set"] is False

    @pytest.mark.parametrize("patch", [{"cl_server": "ASIA"}, {"cl_country": "GB"}, {"cl_country": "gbr"}, {"glooko_region": "UK"}, {"source": "medtronic"}])
    def test_invalid_values_422(self, user, patch):
        s, _ = user
        assert s.put(f"{API}/settings", json=patch).status_code == 422

    def test_glooko_fields(self, user):
        s, _ = user
        for region in ("US", "EU", "CA", "DE-FR"):
            r = s.put(f"{API}/settings", json={"glooko_email": "TEST_g@example.com", "glooko_password": "pw", "glooko_region": region})
            assert r.status_code == 200 and r.json()["glooko_region"] == region
        d = s.get(f"{API}/settings").json()
        assert d["glooko_password"] == "" and d["glooko_password_set"] is True

    def test_empty_secret_keeps_saved(self, user):
        s, uid = user
        s.put(f"{API}/settings", json={"twiist_password": ""})
        assert mdb.settings.find_one({"_id": uid})["twiist_password"] == "nopass123"


# Sync with fake credentials: friendly errors, no crash
class TestSyncErrors:
    def test_twiist_fake_login(self, user):
        s, _ = user
        s.put(f"{API}/settings", json={"source": "twiist"})
        err, last, _ = _sync_error(s)
        assert last and "twiist login failed" in last, last

    def test_glooko_fake_login(self, user):
        s, _ = user
        s.put(f"{API}/settings", json={"source": "glooko", "glooko_region": "US"})
        err, last, _ = _sync_error(s)
        assert last and "Glooko login failed" in last, last

    def test_carelink_no_creds(self, user):
        s, uid = user
        mdb.settings.update_one({"_id": uid}, {"$set": {"cl_username": "", "cl_password": "", "cl_refresh_token": ""}})
        s.put(f"{API}/settings", json={"source": "carelink"})
        err, last, _ = _sync_error(s)
        assert last == "Sign in to CareLink in Settings.", last

    def test_carelink_fake_password_once(self, user):
        s, _ = user
        s.put(f"{API}/settings", json={"cl_username": "TEST_cl_fake", "cl_password": "fakepw1", "cl_server": "EU"})
        err, last, _ = _sync_error(s)
        print("CareLink error:", last)
        assert last and ("not a robot" in last or "CareLink login failed" in last or "CareLink" in last), last


# CareLink in-app sign-in (start / finish / sign out)
class TestCareLinkAuth:
    def test_start_eu(self, user):
        s, _ = user
        r = s.post(f"{API}/carelink/start", json={"server": "EU"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "carelink-login.minimed.eu" in d["url"] and "/authorize" in d["url"]
        assert d["redirect_uri"] == "com.medtronic.carepartner:/sso"
        assert len(d["state"]) == 32 and f"state={d['state']}" in d["url"]
        assert "code_challenge_method=S256" in d["url"]

    def test_start_invalid_server(self, user):
        s, _ = user
        assert s.post(f"{API}/carelink/start", json={"server": "XX"}).status_code == 422

    def test_finish_wrong_state(self, user):
        s, _ = user
        s.post(f"{API}/carelink/start", json={"server": "EU"}, timeout=30)
        r = s.post(f"{API}/carelink/finish", json={"code": "fakecode", "state": "0" * 32})
        assert r.status_code == 400 and "expired" in r.json()["detail"]

    def test_finish_fake_code(self, user):
        s, _ = user
        st = s.post(f"{API}/carelink/start", json={"server": "EU"}, timeout=30).json()["state"]
        r = s.post(f"{API}/carelink/finish", json={"code": "fakecode123", "state": st}, timeout=40)
        assert r.status_code == 400, r.text
        assert "CareLink sign-in could not be completed" in r.json()["detail"]
        # state is single-use
        r2 = s.post(f"{API}/carelink/finish", json={"code": "fakecode123", "state": st})
        assert r2.status_code == 400 and "expired" in r2.json()["detail"]

    def test_sign_out(self, user):
        s, uid = user
        mdb.settings.update_one({"_id": uid}, {"$set": {"cl_refresh_token": "TEST_rt"}})
        assert s.get(f"{API}/settings").json()["cl_refresh_token_set"] is True
        r = s.delete(f"{API}/carelink")
        assert r.status_code == 200 and r.json()["ok"] is True
        d = s.get(f"{API}/settings").json()
        assert d["cl_refresh_token_set"] is False and d["cl_password_set"] is False

    def test_requires_auth(self):
        assert requests.post(f"{API}/carelink/start", json={"server": "EU"}).status_code == 401


# Parsing helpers (unit)
class TestParsers:
    def test_twiist_glucose(self):
        t0 = 568_000_000
        raw = struct.pack("<II", t0, 12345) + struct.pack("<II", t0 + 300, 9800)
        co = zlib.compressobj(wbits=-15)
        blob = base64.b64encode(co.compress(raw) + co.flush()).decode()
        out = cf.twiist_glucose(blob)
        assert out[0] == (datetime(2008, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=t0), 123.45)
        assert out[1][1] == 98.0 and len(out) == 2
        assert cf.twiist_glucose(None) == [] and cf.twiist_glucose("") == []

    def test_carelink_readings_offset(self):
        server_ms = int(datetime(2026, 1, 10, 13, 0, tzinfo=timezone.utc).timestamp() * 1000)
        data = {"patientData": {"sMedicalDeviceTime": "2026-01-10T14:00:30.000", "currentServerTime": server_ms,
                                "lastSGTrend": "UP",
                                "sgs": [{"sg": 140, "datetime": "2026-01-10T13:55:00.000", "kind": "SG"},
                                        {"sg": 130, "datetime": "2026-01-10T13:50:00.000+01:00"},
                                        {"sg": 0, "datetime": "2026-01-10T13:45:00.000"},
                                        {"sg": 99, "datetime": "2026-01-10T13:40:00.000", "kind": "OTHER"}]}}
        out = cf.carelink_readings(data)
        assert [o["sgv"] for o in out] == [130, 140]
        assert out[-1]["ts"] == datetime(2026, 1, 10, 12, 55, tzinfo=timezone.utc)
        assert out[-1]["direction"] == "SingleUp" and out[0]["direction"] == "NONE"

    def test_glooko_readings_tz(self):
        items = [{"display_time": "2026-01-10T10:00:00.000Z", "bg_value": 12000, "trend": "FLAT"},
                 {"display_time": "2026-01-10T10:05:00.000Z", "bg_value": 125},
                 {"display_time": "2026-01-10T10:10:00.000Z", "bg_value": 130, "soft_deleted": True},
                 {"display_time": "2026-01-10T10:15:00.000Z", "bg_value": 70000}]
        out = cf.glooko_readings(items, "Europe/Berlin")
        assert [o["sgv"] for o in out] == [120, 125]
        assert out[0]["ts"] == datetime(2026, 1, 10, 9, 0, tzinfo=timezone.utc) and out[0]["direction"] == "Flat"
        assert cf.glooko_readings(items[:1], "Bad/Zone")[0]["ts"] == datetime(2026, 1, 10, 10, 0, tzinfo=timezone.utc)
