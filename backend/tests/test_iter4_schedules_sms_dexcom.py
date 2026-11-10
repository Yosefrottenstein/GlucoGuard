# Iteration 4: ChannelSchedule windows, phone SMS outbox, Dexcom Share upload
import os
import uuid
from datetime import datetime, timezone

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
CONTACT = {"name": "TEST_Mum", "phone": "+447700900123"}


@pytest.fixture(scope="module")
def api():
    # fresh throwaway user so demo_user settings are never touched
    s = requests.Session()
    creds = {"username": f"TEST_it4_{uuid.uuid4().hex[:8]}", "password": "testpass123"}
    r = s.post(f"{BASE_URL}/api/auth/register", json=creds)
    assert r.status_code in (200, 201), r.text
    tok = r.json().get("access_token") or s.post(f"{BASE_URL}/api/auth/login", json=creds).json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


def put(api, patch):
    return api.put(f"{BASE_URL}/api/settings", json=patch)


def ct(sms=None, call=None, via="cloud"):
    # schedules now live on each contact (iteration 5)
    return {**CONTACT, "sms_via": via, "sms": sms or {"enabled": True, "mode": "always"},
            "call": call or {"enabled": False, "mode": "always"}}


def call_of(r):
    return r.json()["em_contacts"][0]["call"]


# --- ChannelSchedule format (per contact) ---
class TestSchedules:
    def test_defaults(self, api):
        d = api.get(f"{BASE_URL}/api/settings").json()
        assert "em_sms_schedule" not in d and "em_sms_via" not in d
        r = put(api, {"em_contacts": [{**CONTACT}]})
        c = r.json()["em_contacts"][0]
        assert c["sms_via"] == "cloud" and c["sms"]["mode"] == "always" and c["sms"]["repeat_minutes"] == 5
        assert d["dx_upload"] is False and d["dx_serial"] == "SM00000000"

    def test_multi_windows_persist(self, api):
        sched = {"enabled": True, "mode": "hours", "windows": [
            {"days": [4, 0, 0], "start": "22:00", "end": "07:30"},
            {"days": [5, 6], "start": "00:00", "end": "23:30"}]}
        assert put(api, {"em_contacts": [ct(call=sched)]}).status_code == 200
        got = api.get(f"{BASE_URL}/api/settings").json()["em_contacts"][0]["call"]
        assert got["windows"][0] == {"days": [0, 4], "start": "22:00", "end": "07:30"}  # dedup + sorted
        assert got["windows"][1]["days"] == [5, 6]

    def test_old_format_migrates(self, api):
        r = put(api, {"em_contacts": [ct(call={"mode": "hours", "start": "21:00", "end": "06:00"})]})
        assert r.status_code == 200, r.text
        assert call_of(r)["windows"] == [{"days": [0, 1, 2, 3, 4, 5, 6], "start": "21:00", "end": "06:00"}]

    def test_hours_empty_windows_gets_default(self, api):
        r = put(api, {"em_contacts": [ct(call={"mode": "hours", "windows": []})]})
        assert r.status_code == 200, r.text
        assert len(call_of(r)["windows"]) == 1

    @pytest.mark.parametrize("bad", [
        {"mode": "hours", "windows": [{"days": [7], "start": "00:00", "end": "07:00"}]},
        {"mode": "hours", "windows": [{"days": [], "start": "00:00", "end": "07:00"}]},
        {"mode": "hours", "windows": [{"days": [1], "start": "24:00", "end": "07:00"}]},
        {"mode": "weird", "windows": []},
    ])
    def test_invalid_schedule_422(self, api, bad):
        assert put(api, {"em_contacts": [ct(call=bad)]}).status_code == 422

    def test_contact_schedule_persist(self, api):
        c = ct(call={"enabled": True, "mode": "hours", "windows": [{"days": [0, 1, 2, 3, 4], "start": "08:00", "end": "17:00"}]})
        assert put(api, {"em_contacts": [c]}).status_code == 200
        got = api.get(f"{BASE_URL}/api/settings").json()["em_contacts"][0]
        assert got["call"]["windows"][0]["days"] == [0, 1, 2, 3, 4]
        assert got["sms"]["mode"] == "always"


# --- Emergency SMS via phone outbox / cloud missing keys ---
class TestEmergency:
    def test_cloud_missing_twilio(self, api):
        put(api, {"em_contacts": [ct()]})
        r = api.post(f"{BASE_URL}/api/emergency/test")
        assert r.status_code == 400
        assert "Twilio" in r.json()["detail"]

    def test_phone_queues_outbox_and_result(self, api):
        put(api, {"em_contacts": [ct(via="phone")]})
        r = api.post(f"{BASE_URL}/api/emergency/test")
        assert r.status_code == 200, r.text
        assert "Text to TEST_Mum handed to your phone" in r.json()["results"]
        box = api.get(f"{BASE_URL}/api/sms/outbox").json()
        item = [b for b in box if b["to"] == CONTACT["phone"]][-1]
        assert item["body"].startswith("TEST")
        assert api.post(f"{BASE_URL}/api/sms/outbox/{item['id']}", json={"ok": False, "error": "TEST_no signal"}).json() == {"ok": True}
        assert item["id"] not in [b["id"] for b in api.get(f"{BASE_URL}/api/sms/outbox").json()]
        log = api.get(f"{BASE_URL}/api/emergency/log").json()
        assert "Phone text to TEST_Mum failed: TEST_no signal" in log[0]["results"]

    def test_outbox_bad_id_404(self, api):
        assert api.post(f"{BASE_URL}/api/sms/outbox/notanid", json={"ok": True}).status_code == 404
        assert api.post(f"{BASE_URL}/api/sms/outbox/{'0'*24}", json={"ok": True}).status_code == 404

    def test_call_outside_weekday_window(self, api):
        other = [(datetime.now(timezone.utc).weekday() + 3) % 7]
        put(api, {"tz": "UTC", "em_contacts": [ct(via="phone", call={
            "enabled": True, "mode": "hours", "windows": [{"days": other, "start": "00:00", "end": "00:00"}]})]})
        r = api.post(f"{BASE_URL}/api/emergency/test")
        assert r.status_code == 200, r.text
        assert "No call to TEST_Mum (outside the set hours)" in r.json()["results"]

    def test_call_inside_window_needs_twilio(self, api):
        today = datetime.now(timezone.utc).weekday()
        put(api, {"tz": "UTC", "em_contacts": [ct(via="phone", call={
            "enabled": True, "mode": "hours", "windows": [{"days": [today], "start": "00:00", "end": "00:00"}]})]})
        r = api.post(f"{BASE_URL}/api/emergency/test")
        assert r.status_code == 200, r.text
        assert "Call to TEST_Mum failed: Twilio keys missing" in r.json()["results"]

    def test_contact_channel_off_no_line(self, api):
        put(api, {"em_contacts": [ct(via="phone", sms={"enabled": False}, call={"enabled": True, "mode": "always"})]})
        r = api.post(f"{BASE_URL}/api/emergency/test")
        assert r.status_code == 200
        assert not any("text" in x.lower() for x in r.json()["results"])  # disabled channel produces no line


# --- Dexcom Share upload ---
class TestDexcom:
    def test_serial_validation(self, api):
        assert put(api, {"dx_serial": "sm1"}).status_code == 422
        r = put(api, {"dx_serial": "SM12345678", "dx_upload": True})
        assert r.status_code == 200 and r.json()["dx_serial"] == "SM12345678" and r.json()["dx_upload"] is True

    def test_upload_no_creds(self, api):
        r = api.post(f"{BASE_URL}/api/dexcom/upload")
        assert r.status_code == 400
        assert r.json()["detail"] == "Add your Dexcom username and password first."

    def test_upload_fake_creds(self, api):
        put(api, {"dexcom_username": "TEST_fake_user_xyz", "dexcom_password": "TEST_wrong_pw_123", "dexcom_region": "us"})
        # fresh user is on demo source: demo readings are never pushed (iteration 5 guard)
        r = api.post(f"{BASE_URL}/api/dexcom/upload", timeout=60)
        assert r.status_code == 400, r.text
        assert "Demo readings are never sent to Dexcom" in r.json()["detail"], r.json()["detail"]
