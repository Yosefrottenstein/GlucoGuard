# Iteration 8: user's own Twilio account settings, per-contact Twilio failures, location address in SMS, username rules
import os
import uuid

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

FE_ENV = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or FE_ENV.get("EXPO_PUBLIC_BACKEND_URL")).rstrip("/")
BE_ENV = dotenv_values("/app/backend/.env")
mdb = MongoClient(BE_ENV["MONGO_URL"])[BE_ENV["DB_NAME"]]
API = f"{BASE_URL}/api"
FAKE_SID = "AC" + "0123456789abcdef" * 2
FAKE_TOKEN = "TEST_" + "f" * 27
FAKE_FROM = "+15005550006"
CREATED_USERS = []


def _contact(phone, via, sms=True, call=False):
    ch = lambda en: {"enabled": en, "mode": "always", "windows": [], "repeat_minutes": 5}  # noqa: E731
    return {"name": f"TEST_{via}", "phone": phone, "sms": ch(sms), "call": ch(call), "sms_via": via}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    r = sess.post(f"{API}/auth/login", json={"username": "demo_user", "password": "demo12345"}, timeout=30)
    if r.status_code != 200:
        pytest.skip("demo login failed")
    sess.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    orig = sess.get(f"{API}/settings", timeout=30).json()
    yield sess
    # restore demo_user emergency state as instructed
    sess.put(f"{API}/settings", json={"twilio_sid": "", "twilio_from": "", "em_contacts": [], "em_enabled": False,
                                      "em_location": orig.get("em_location", True)}, timeout=30)
    for u in CREATED_USERS:
        mdb.users.delete_one({"username": u})


# --- Twilio settings ---
def test_invalid_sid_422(s):
    r = s.put(f"{API}/settings", json={"twilio_sid": "ACbad"}, timeout=30)
    assert r.status_code == 422


def test_invalid_from_422(s):
    r = s.put(f"{API}/settings", json={"twilio_from": "15551234567"}, timeout=30)
    assert r.status_code == 422


def test_save_twilio_token_secret(s):
    r = s.put(f"{API}/settings", json={"twilio_sid": FAKE_SID, "twilio_token": FAKE_TOKEN, "twilio_from": FAKE_FROM}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["twilio_sid"] == FAKE_SID and d["twilio_from"] == FAKE_FROM
    assert d["twilio_token"] == "" and d["twilio_token_set"] is True
    g = s.get(f"{API}/settings", timeout=30).json()
    assert g["twilio_token"] == "" and g["twilio_token_set"] is True and g["twilio_sid"] == FAKE_SID


def test_empty_token_keeps_saved(s):
    r = s.put(f"{API}/settings", json={"twilio_token": ""}, timeout=30)
    assert r.status_code == 200 and r.json()["twilio_token_set"] is True
    uid = str(mdb.users.find_one({"username": "demo_user"})["_id"])
    assert mdb.settings.find_one({"_id": uid})["twilio_token"] == FAKE_TOKEN


# --- Emergency test with user's own (fake) Twilio ---
def test_emergency_test_twilio_auth_error_per_contact(s):
    r = s.put(f"{API}/settings", json={"em_contacts": [_contact("+15550000001", "cloud", sms=True, call=True)]}, timeout=30)
    assert r.status_code == 200, r.text
    r = s.post(f"{API}/emergency/test", timeout=60)
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    print(res)
    assert any(x.startswith("Text to TEST_cloud failed") for x in res)
    assert any(x.startswith("Call to TEST_cloud failed") for x in res)


def test_no_twilio_cloud_only_400(s):
    r = s.put(f"{API}/settings", json={"twilio_sid": "", "twilio_from": ""}, timeout=30)
    assert r.status_code == 200 and r.json()["twilio_sid"] == ""
    r = s.post(f"{API}/emergency/test", timeout=60)
    assert r.status_code == 400
    assert "Twilio account" in r.json()["detail"]


# --- Location address in SMS ---
def test_location_address_too_long_422(s):
    r = s.post(f"{API}/location", json={"lat": 1, "lon": 2, "address": "x" * 201}, timeout=30)
    assert r.status_code == 422


def test_sms_contains_address_and_map(s):
    addr = f"TEST_{uuid.uuid4().hex[:6]} 1 Main St, Springfield"
    assert s.post(f"{API}/location", json={"lat": 40.7128, "lon": -74.006, "address": addr}, timeout=30).status_code == 200
    phone = "+15550000002"
    r = s.put(f"{API}/settings", json={"em_location": True, "em_contacts": [_contact(phone, "phone", sms=True, call=False)]}, timeout=30)
    assert r.status_code == 200, r.text
    r = s.post(f"{API}/emergency/test", timeout=60)
    assert r.status_code == 200, r.text
    assert any("handed to your phone" in x for x in r.json()["results"])
    log = s.get(f"{API}/emergency/log", timeout=30).json()[0]
    assert addr in log["message"] and "https://maps.google.com/?q=40.71280,-74.00600" in log["message"]
    out = s.get(f"{API}/sms/outbox", timeout=30).json()
    mine = [o for o in out if o["to"] == phone and addr in o["body"]]
    assert mine and "maps.google.com" in mine[-1]["body"]
    for o in mine:  # mark ours done so the outbox is clean
        s.post(f"{API}/sms/outbox/{o['id']}", json={"ok": False, "error": "TEST cleanup"}, timeout=30)


def test_phone_contact_call_without_twilio_reported(s):
    r = s.put(f"{API}/settings", json={"em_contacts": [_contact("+15550000003", "phone", sms=False, call=True)]}, timeout=30)
    assert r.status_code == 200
    r = s.post(f"{API}/emergency/test", timeout=60)
    assert r.status_code == 200, r.text
    assert any("Call to TEST_phone failed: add your Twilio account first" in x for x in r.json()["results"])


# --- Username rules ---
def test_register_4_chars_422():
    r = requests.post(f"{API}/auth/register", json={"username": "abcd", "password": "password1"}, timeout=30)
    assert r.status_code == 422


def test_register_5_chars_201():
    name = "t" + uuid.uuid4().hex[:4]
    r = requests.post(f"{API}/auth/register", json={"username": name, "password": "password1"}, timeout=30)
    assert r.status_code == 201, r.text
    CREATED_USERS.append(name)
    assert r.json()["username"] == name and r.json()["access_token"]


def test_register_space_422():
    r = requests.post(f"{API}/auth/register", json={"username": "ab cde", "password": "password1"}, timeout=30)
    assert r.status_code == 422
