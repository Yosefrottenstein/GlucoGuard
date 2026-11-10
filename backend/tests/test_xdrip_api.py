"""Backend regression tests for xDrip+ iOS clone."""
import os
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if "EXPO_PUBLIC_BACKEND_URL" in os.environ else None
if not BASE_URL:
    # read from frontend .env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    return s


# ---------- status / settings ----------
class TestStatus:
    def test_status_shape(self, api):
        r = api.get(f"{BASE_URL}/api/status")
        assert r.status_code == 200
        data = r.json()
        for key in ("reading", "source", "unit", "thresholds", "upload_errors"):
            assert key in data
        assert data["thresholds"].keys() >= {"urgent_low", "low", "high", "urgent_high"}

    def test_settings_get_masks_secrets(self, api):
        r = api.get(f"{BASE_URL}/api/settings")
        assert r.status_code == 200
        s = r.json()
        for f in ("ns_secret", "dexcom_password", "libre_password", "tp_password"):
            assert s[f] == ""
            assert (f + "_set") in s

    def test_settings_put_threshold_order_422(self, api):
        r = api.put(f"{BASE_URL}/api/settings", json={"urgent_low": 100, "low": 80, "high": 180, "urgent_high": 250})
        assert r.status_code == 422

    def test_settings_put_valid_update(self, api):
        r = api.put(f"{BASE_URL}/api/settings", json={"unit": "mgdl", "source": "demo"})
        assert r.status_code == 200
        assert r.json()["unit"] == "mgdl"
        assert r.json()["source"] == "demo"


# ---------- readings ----------
class TestReadings:
    def test_readings_range(self, api):
        start = (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()
        r = api.get(f"{BASE_URL}/api/readings", params={"start": start})
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        if data:
            assert {"ts", "sgv", "direction"} <= set(data[0].keys())

    def test_readings_bucketing(self, api):
        start = (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat()
        r = api.get(f"{BASE_URL}/api/readings", params={"start": start, "bucket": 30})
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_readings_range_too_large(self, api):
        start = (datetime.now(timezone.utc) - timedelta(days=200)).isoformat()
        r = api.get(f"{BASE_URL}/api/readings", params={"start": start})
        assert r.status_code == 400

    def test_manual_reading_requires_manual_source_not_enforced(self, api):
        # manual reading works regardless; just verify shape after insert on demo source
        ts = (datetime.now(timezone.utc) - timedelta(days=89)).isoformat()  # unique slot in past
        r = api.post(f"{BASE_URL}/api/readings", json={"sgv": 123, "ts": ts})
        if r.status_code == 409:
            pytest.skip("duplicate ts, that's fine")
        assert r.status_code == 200, r.text
        assert r.json()["sgv"] == 123


# ---------- treatments ----------
class TestTreatments:
    created_ids: list[str] = []

    def test_create_insulin(self, api):
        r = api.post(f"{BASE_URL}/api/treatments", json={"kind": "insulin", "insulin": 1.5, "note": "TEST_"})
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        TestTreatments.created_ids.append(tid)
        assert r.json()["insulin"] == 1.5

    def test_create_carbs(self, api):
        r = api.post(f"{BASE_URL}/api/treatments", json={"kind": "carbs", "carbs": 30, "note": "TEST_"})
        assert r.status_code == 200
        TestTreatments.created_ids.append(r.json()["id"])

    def test_create_note(self, api):
        r = api.post(f"{BASE_URL}/api/treatments", json={"kind": "note", "note": "TEST_sample"})
        assert r.status_code == 200
        TestTreatments.created_ids.append(r.json()["id"])

    def test_create_insulin_missing_units_422(self, api):
        r = api.post(f"{BASE_URL}/api/treatments", json={"kind": "insulin"})
        assert r.status_code == 422

    def test_list_contains(self, api):
        start = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        r = api.get(f"{BASE_URL}/api/treatments", params={"start": start})
        assert r.status_code == 200
        ids = {t["id"] for t in r.json()}
        for tid in TestTreatments.created_ids:
            assert tid in ids

    def test_delete_cleanup(self, api):
        for tid in TestTreatments.created_ids:
            r = api.delete(f"{BASE_URL}/api/treatments/{tid}")
            assert r.status_code == 200
        # verify deletion
        start = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        r = api.get(f"{BASE_URL}/api/treatments", params={"start": start})
        ids = {t["id"] for t in r.json()}
        for tid in TestTreatments.created_ids:
            assert tid not in ids

    def test_delete_bad_id(self, api):
        r = api.delete(f"{BASE_URL}/api/treatments/not-an-oid")
        assert r.status_code == 404


# ---------- stats ----------
class TestStats:
    def test_stats_returns_tir(self, api):
        start = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        r = api.get(f"{BASE_URL}/api/stats", params={"start": start})
        assert r.status_code == 200
        s = r.json()
        assert s["count"] > 0
        for k in ("average", "median", "sd", "cv", "gmi", "tir"):
            assert k in s
        assert {"very_low", "low", "in_range", "high", "very_high"} <= set(s["tir"].keys())


# ---------- alarm/location/emergency ----------
class TestAlarmLocationEmergency:
    def test_ack_ok(self, api):
        r = api.post(f"{BASE_URL}/api/alarm/ack", json={"minutes": 10})
        assert r.status_code == 200

    def test_location_persist(self, api):
        r = api.post(f"{BASE_URL}/api/location", json={"lat": 37.0, "lon": -122.0})
        assert r.status_code == 200

    def test_emergency_test_no_twilio_400(self, api):
        # ensure a contact exists so we hit twilio check path
        api.put(f"{BASE_URL}/api/settings", json={
            "em_contacts": [{"name": "TEST_c", "phone": "+15551234567"}]
        })
        r = api.post(f"{BASE_URL}/api/emergency/test")
        assert r.status_code == 400
        assert "not set up" in r.json().get("detail", "").lower()

    def test_emergency_log(self, api):
        r = api.get(f"{BASE_URL}/api/emergency/log")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- sync / uploads ----------
class TestSyncUploads:
    def test_sync(self, api):
        r = api.post(f"{BASE_URL}/api/sync")
        assert r.status_code == 200
        assert "added" in r.json()

    def test_ns_upload_without_url_400(self, api):
        api.put(f"{BASE_URL}/api/settings", json={"ns_url": "", "ns_secret": ""})
        r = api.post(f"{BASE_URL}/api/nightscout/upload")
        assert r.status_code == 400

    def test_tp_upload_without_creds_400(self, api):
        api.put(f"{BASE_URL}/api/settings", json={"tp_email": "", "tp_password": ""})
        r = api.post(f"{BASE_URL}/api/tidepool/upload")
        assert r.status_code == 400


# ---------- ai summary ----------
class TestAISummary:
    def test_get_summary_not_found_shape(self, api):
        r = api.get(f"{BASE_URL}/api/ai/summary", params={"label": "TEST_none_ever"})
        assert r.status_code == 200
        assert r.json().get("text") is None or isinstance(r.json().get("text"), str)

    def test_post_summary_no_data_400(self, api):
        start = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
        end = (datetime.now(timezone.utc) + timedelta(days=6)).isoformat()
        r = api.post(f"{BASE_URL}/api/ai/summary", json={"start": start, "end": end, "label": "TEST_future"})
        assert r.status_code == 400

    def test_post_summary_streams(self, api):
        start = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        end = datetime.now(timezone.utc).isoformat()
        r = requests.post(f"{BASE_URL}/api/ai/summary", json={"start": start, "end": end, "label": "TEST_today"},
                          stream=True, timeout=60)
        assert r.status_code == 200
        chunks = []
        deadline = time.time() + 25
        for line in r.iter_lines():
            if time.time() > deadline:
                break
            if line:
                chunks.append(line.decode())
                if b"done" in line or b"error" in line:
                    break
        r.close()
        assert chunks, "expected SSE chunks"


# ---------- cleanup: restore source=demo, unit=mgdl ----------
class TestZCleanup:
    def test_restore_defaults(self, api):
        r = api.put(f"{BASE_URL}/api/settings", json={"source": "demo", "unit": "mgdl", "em_contacts": []})
        assert r.status_code == 200
        assert r.json()["source"] == "demo"
        assert r.json()["unit"] == "mgdl"
