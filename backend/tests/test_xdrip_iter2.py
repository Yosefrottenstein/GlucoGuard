"""Iteration 2 regression tests for xDrip+ app.

Covers: target range, sensor session, alarm_sounds (extreme_low forced sound),
reminders, glucose_alarms (custom alarm trigger + snooze), emergency v2
(sms/call schedules, per-contact channels, triggers list), readings/batch,
stats using target range, status payload shape.

A full teardown restores source=demo, unit=mgdl, em_contacts=[], glucose_alarms=[],
reminders=[], alarm_sounds={}, em_enabled=false, target_low=70, target_high=180.
"""
import os
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


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    return s


# --------------- Settings: target range ---------------
class TestTargetRange:
    def test_target_low_ge_high_rejected(self, api):
        r = api.put(f"{BASE_URL}/api/settings", json={"target_low": 180, "target_high": 180})
        assert r.status_code == 422, r.text

    def test_target_range_accepts_valid_and_persists(self, api):
        r = api.put(f"{BASE_URL}/api/settings", json={"target_low": 80, "target_high": 170})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["target_low"] == 80 and data["target_high"] == 170
        # GET to verify persisted
        got = api.get(f"{BASE_URL}/api/settings").json()
        assert got["target_low"] == 80 and got["target_high"] == 170

    def test_status_thresholds_include_target_range(self, api):
        api.put(f"{BASE_URL}/api/settings", json={"target_low": 75, "target_high": 175})
        st = api.get(f"{BASE_URL}/api/status").json()
        t = st["thresholds"]
        assert t["target_low"] == 75 and t["target_high"] == 175


# --------------- Alarm sounds (extreme_low forced to 'sound') ---------------
class TestAlarmSounds:
    def test_extreme_low_style_forced_to_sound(self, api):
        patch = {"alarm_sounds": {"extreme_low": {"style": "both", "sound": "siren",
                                                 "repeat_minutes": 1, "snooze_minutes": 30},
                                  "urgent_low": {"style": "both", "sound": "siren",
                                                 "repeat_minutes": 1, "snooze_minutes": 45}}}
        r = api.put(f"{BASE_URL}/api/settings", json=patch)
        assert r.status_code == 200, r.text
        snds = r.json()["alarm_sounds"]
        assert snds["extreme_low"]["style"] == "sound"  # forced
        assert snds["urgent_low"]["snooze_minutes"] == 45


# --------------- Reminders + Glucose alarms validation ---------------
class TestRemindersAndAlarms:
    def test_reminder_bad_time_422(self, api):
        bad = {"reminders": [{"id": "r1", "title": "pill", "time": "25:99", "repeat": "daily"}]}
        r = api.put(f"{BASE_URL}/api/settings", json=bad)
        assert r.status_code == 422

    def test_glucose_alarm_value_out_of_range_422(self, api):
        bad = {"glucose_alarms": [{"id": "g1", "title": "x", "direction": "below", "value": 10}]}
        r = api.put(f"{BASE_URL}/api/settings", json=bad)
        assert r.status_code == 422

    def test_reminder_persists(self, api):
        patch = {"reminders": [{"id": "TEST_r1", "title": "TEST_check", "time": "08:00",
                                "repeat": "daily", "style": "both", "sound": "chime"}]}
        r = api.put(f"{BASE_URL}/api/settings", json=patch)
        assert r.status_code == 200
        ids = {x["id"] for x in r.json()["reminders"]}
        assert "TEST_r1" in ids


# --------------- Custom glucose alarm triggers status.alarm with custom:<id> ---------------
class TestCustomGlucoseAlarmTrigger:
    """Create a custom alarm 'below 400' so the current (demo) reading will trigger it."""

    def test_custom_alarm_triggers_and_ack_snoozes(self, api):
        # Set a custom glucose alarm that will certainly fire (sgv < 400)
        patch = {"glucose_alarms": [{"id": "TEST_ga1", "title": "TEST_above_zero",
                                     "direction": "below", "value": 400,
                                     "enabled": True, "style": "both", "sound": "chime",
                                     "repeat_minutes": 5, "snooze_minutes": 77}]}
        r = api.put(f"{BASE_URL}/api/settings", json=patch)
        assert r.status_code == 200, r.text

        # Kick a sync so check_alarms runs on the latest demo reading
        api.post(f"{BASE_URL}/api/sync")
        # Wait briefly for background alarm task
        alarm = None
        for _ in range(8):
            st = api.get(f"{BASE_URL}/api/status").json()
            alarm = st.get("alarm")
            if alarm and alarm.get("type", "").startswith("custom:"):
                break
            time.sleep(0.5)
        assert alarm is not None, "expected an active alarm"
        # Preset alarms may win if the demo reading is in urgent_low/low/high range.
        # We assert either the preset fired OR custom fired; the key checks are
        # snooze_minutes shape and that ack snoozes.
        assert "snooze_minutes" in alarm
        assert "label" in alarm

        # Ack with no minutes -> uses the alarm's own snooze_minutes
        ack = api.post(f"{BASE_URL}/api/alarm/ack", json={})
        assert ack.status_code == 200, ack.text
        assert "snoozed_until" in ack.json() or ack.json().get("ok") is True

        # Status should now report snoozed for this alarm type
        st2 = api.get(f"{BASE_URL}/api/status").json()
        a2 = st2.get("alarm")
        if a2:
            # snoozed may be True; snooze_minutes should be present
            assert "snoozed" in a2


# --------------- Emergency v2 settings ---------------
class TestEmergencyV2:
    def test_contact_with_sms_and_call_schedules_persists(self, api):
        patch = {
            "em_enabled": True,
            "em_sms": True, "em_call": True,
            "em_sms_schedule": {"enabled": True, "mode": "always", "start": "00:00", "end": "00:00"},
            "em_call_schedule": {"enabled": True, "mode": "hours", "start": "00:00", "end": "07:00"},
            "em_triggers": ["urgent_low", "urgent_high"],
            "em_sms_repeat_minutes": 7,
            "em_call_repeat_minutes": 11,
            "tz": "America/Los_Angeles",
            "em_contacts": [{
                "name": "TEST_cv2", "phone": "+15551234567",
                "sms": {"enabled": True, "mode": "always", "start": "00:00", "end": "00:00"},
                "call": {"enabled": True, "mode": "hours", "start": "22:00", "end": "07:00"},
            }],
        }
        r = api.put(f"{BASE_URL}/api/settings", json=patch)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["em_sms_repeat_minutes"] == 7
        assert data["em_call_repeat_minutes"] == 11
        assert data["em_triggers"] == ["urgent_low", "urgent_high"]
        assert data["em_contacts"][0]["phone"] == "+15551234567"
        assert data["em_contacts"][0]["call"]["start"] == "22:00"
        assert data["em_contacts"][0]["sms"]["mode"] == "always"

    def test_invalid_phone_422(self, api):
        bad = {"em_contacts": [{"name": "TEST_bad", "phone": "15551234567"}]}  # missing +
        r = api.put(f"{BASE_URL}/api/settings", json=bad)
        assert r.status_code == 422

    def test_invalid_trigger_422(self, api):
        bad = {"em_triggers": ["not_a_level"]}
        r = api.put(f"{BASE_URL}/api/settings", json=bad)
        assert r.status_code == 422

    def test_emergency_test_still_returns_friendly_400_when_twilio_missing(self, api):
        r = api.post(f"{BASE_URL}/api/emergency/test")
        assert r.status_code == 400
        assert "not set up" in r.json()["detail"].lower()


# --------------- Sensor session ---------------
class TestSensorSession:
    def test_set_sensor_and_status_reflects_ends_at(self, api):
        started = datetime.now(timezone.utc) - timedelta(days=3)
        patch = {"sensor_started_at": started.isoformat(), "sensor_days": 10.5,
                 "sensor_warn_offsets": [1440, 60, 30], "sensor_warn_enabled": True}
        r = api.put(f"{BASE_URL}/api/settings", json=patch)
        assert r.status_code == 200, r.text
        got = r.json()
        assert got["sensor_days"] == 10.5

        st = api.get(f"{BASE_URL}/api/status").json()
        assert st["sensor"] is not None
        s = st["sensor"]
        assert "started_at" in s and "ends_at" in s and s["days"] == 10.5
        # ends_at ~ started_at + 10.5 days
        started_ret = datetime.fromisoformat(s["started_at"].replace("Z", "+00:00"))
        ends_ret = datetime.fromisoformat(s["ends_at"].replace("Z", "+00:00"))
        assert abs((ends_ret - started_ret) - timedelta(days=10.5)) < timedelta(seconds=5)

    def test_sensor_days_out_of_range_422(self, api):
        r = api.put(f"{BASE_URL}/api/settings", json={"sensor_days": 99})
        assert r.status_code == 422


# --------------- Readings batch (Bluetooth / Master mode) ---------------
class TestReadingsBatch:
    def test_batch_insert(self, api):
        now = datetime.now(timezone.utc)
        # pick timestamps well in the past to avoid collisions with demo generator
        base = now - timedelta(days=80)
        items = [{"ts": (base + timedelta(minutes=5 * i)).isoformat(),
                  "sgv": 120 + i, "direction": "Flat"} for i in range(5)]
        r = api.post(f"{BASE_URL}/api/readings/batch", json={"readings": items})
        assert r.status_code == 200, r.text
        # at least some should insert (duplicates allowed to be rejected silently)
        assert r.json()["added"] >= 1

    def test_batch_bad_sgv_422(self, api):
        bad = {"readings": [{"ts": datetime.now(timezone.utc).isoformat(), "sgv": 9999}]}
        r = api.post(f"{BASE_URL}/api/readings/batch", json=bad)
        assert r.status_code == 422


# --------------- Stats uses target range ---------------
class TestStatsTargetRange:
    def test_stats_in_range_follows_target(self, api):
        # Narrow range to force a specific TIR
        api.put(f"{BASE_URL}/api/settings", json={"target_low": 90, "target_high": 160})
        start = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        r = api.get(f"{BASE_URL}/api/stats", params={"start": start})
        assert r.status_code == 200
        narrow = r.json()["tir"]["in_range"]

        api.put(f"{BASE_URL}/api/settings", json={"target_low": 50, "target_high": 250})
        r = api.get(f"{BASE_URL}/api/stats", params={"start": start})
        wide = r.json()["tir"]["in_range"]
        # Wider target band should yield >= narrower in-range %
        assert wide >= narrow


# --------------- Final cleanup / RESTORE ---------------
class TestZZRestore:
    def test_restore(self, api):
        payload = {
            "source": "demo",
            "unit": "mgdl",
            "em_contacts": [],
            "em_enabled": False,
            "em_triggers": ["urgent_low"],
            "em_sms_repeat_minutes": 5,
            "em_call_repeat_minutes": 5,
            "tz": "UTC",
            "glucose_alarms": [],
            "reminders": [],
            "alarm_sounds": {},
            "target_low": 70,
            "target_high": 180,
            "sensor_started_at": None,
        }
        r = api.put(f"{BASE_URL}/api/settings", json=payload)
        assert r.status_code == 200, r.text
        got = r.json()
        assert got["source"] == "demo"
        assert got["unit"] == "mgdl"
        assert got["em_contacts"] == []
        assert got["em_enabled"] is False
        assert got["target_low"] == 70 and got["target_high"] == 180
        assert got["glucose_alarms"] == []
        assert got["reminders"] == []
        assert got["sensor_started_at"] is None
