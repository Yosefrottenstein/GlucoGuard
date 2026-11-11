# Iteration 9: DELETE /api/twilio and readings batch source 'companion' + GET /api/readings source field
import os
from datetime import datetime, timezone

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or dotenv_values("/app/frontend/.env")["EXPO_PUBLIC_BACKEND_URL"]).rstrip("/")
API = f"{BASE_URL}/api"
ENV = dotenv_values("/app/backend/.env")
mdb = MongoClient(ENV["MONGO_URL"])[ENV["DB_NAME"]]

SID = "AC0123456789abcdef0123456789abcdef"
TS_COMP = ["2026-11-11T03:02:17Z", "2026-11-11T03:07:17Z"]
TS_BT = "2026-11-11T03:12:17Z"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    r = sess.post(f"{API}/auth/login", json={"username": "demo_user", "password": "demo12345"})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    sess.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    uid = str(mdb.users.find_one({"username": "demo_user"})["_id"])
    yield sess
    # cleanup: only our test readings, by exact ts + uid
    ts_list = [datetime.fromisoformat(t.replace("Z", "+00:00")) for t in TS_COMP + [TS_BT]]
    mdb.readings.delete_many({"uid": uid, "ts": {"$in": ts_list}})
    sess.delete(f"{API}/twilio")


# Twilio disconnect
class TestTwilioDelete:
    def test_requires_auth(self):
        r = requests.delete(f"{API}/twilio")
        assert r.status_code == 401

    def test_save_then_delete(self, s):
        r = s.put(f"{API}/settings", json={"twilio_sid": SID, "twilio_token": "TEST_tok123", "twilio_from": "+15550001111"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["twilio_sid"] == SID and d["twilio_token_set"] is True and d["twilio_from"] == "+15550001111"
        r = s.delete(f"{API}/twilio")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["twilio_sid"] == "" and d["twilio_from"] == "" and d["twilio_token_set"] is False and d["twilio_token"] == ""
        g = s.get(f"{API}/settings").json()
        assert g["twilio_sid"] == "" and g["twilio_from"] == "" and g["twilio_token_set"] is False
        uid = str(mdb.users.find_one({"username": "demo_user"})["_id"])
        raw = mdb.settings.find_one({"_id": uid})
        assert raw["twilio_token"] == "" and raw["twilio_sid"] == "" and raw["twilio_from"] == ""

    def test_delete_idempotent(self, s):
        r = s.delete(f"{API}/twilio")
        assert r.status_code == 200 and r.json()["twilio_token_set"] is False


# Readings batch with source
class TestBatchSource:
    def test_companion_source(self, s):
        body = {"source": "companion", "readings": [{"ts": TS_COMP[0], "sgv": 111, "direction": "Flat"},
                                                     {"ts": TS_COMP[1], "sgv": 115, "direction": "FortyFiveUp"}]}
        r = s.post(f"{API}/readings/batch", json=body)
        assert r.status_code == 200, r.text
        assert r.json()["added"] == 2
        uid = str(mdb.users.find_one({"username": "demo_user"})["_id"])
        docs = list(mdb.readings.find({"uid": uid, "ts": {"$in": [datetime(2026, 11, 11, 3, 2, 17), datetime(2026, 11, 11, 3, 7, 17)]}}))
        assert len(docs) == 2 and all(d["source"] == "companion" for d in docs)

    def test_default_bluetooth(self, s):
        r = s.post(f"{API}/readings/batch", json={"readings": [{"ts": TS_BT, "sgv": 120, "direction": "Flat"}]})
        assert r.status_code == 200 and r.json()["added"] == 1
        uid = str(mdb.users.find_one({"username": "demo_user"})["_id"])
        doc = mdb.readings.find_one({"uid": uid, "ts": datetime(2026, 11, 11, 3, 12, 17)})
        assert doc and doc["source"] == "bluetooth"

    def test_invalid_source(self, s):
        r = s.post(f"{API}/readings/batch", json={"source": "hacker", "readings": [{"ts": "2026-11-11T03:22:17Z", "sgv": 120}]})
        assert r.status_code == 422

    def test_get_readings_includes_source(self, s):
        r = s.get(f"{API}/readings", params={"start": "2026-11-11T03:00:00Z", "end": "2026-11-11T03:15:00Z"})
        assert r.status_code == 200, r.text
        rows = r.json()
        mine = {row["ts"][:19]: row for row in rows}
        assert "2026-11-11T03:02:17" in mine, rows
        assert "source" in mine["2026-11-11T03:02:17"], f"source missing in row: {mine['2026-11-11T03:02:17']}"
        assert mine["2026-11-11T03:02:17"]["source"] == "companion"
        assert mine["2026-11-11T03:12:17"]["source"] == "bluetooth"
