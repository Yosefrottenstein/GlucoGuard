"""Uploaders: Nightscout and Tidepool."""
from datetime import datetime, timezone

import httpx

from models import AppSettings, Reading, Treatment
from sources import ns_auth

DEVICE = "xDrip-iOS"


def _iso(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


async def upload_nightscout(s: AppSettings, readings: list[Reading], treatments: list[Treatment]) -> None:
    headers, params = ns_auth(s.ns_secret)
    base = s.ns_url.rstrip("/")
    async with httpx.AsyncClient(timeout=30) as c:
        if readings:
            body = [{"type": "sgv", "sgv": r.sgv, "date": int(r.ts.timestamp() * 1000), "dateString": _iso(r.ts),
                     "direction": r.direction, "device": DEVICE} for r in readings]
            resp = await c.post(f"{base}/api/v1/entries", headers=headers, params=params, json=body)
            if resp.status_code >= 400:
                raise RuntimeError(f"Nightscout rejected the upload ({resp.status_code}). Check URL and API secret.")
        if treatments:
            body = []
            for t in treatments:
                event = {"insulin": "Correction Bolus", "carbs": "Carb Correction", "note": "Note"}[t.kind]
                body.append({"eventType": event, "created_at": _iso(t.ts), "insulin": t.insulin, "carbs": t.carbs,
                             "notes": t.note or "", "enteredBy": DEVICE})
            resp = await c.post(f"{base}/api/v1/treatments", headers=headers, params=params, json=body)
            if resp.status_code >= 400:
                raise RuntimeError(f"Nightscout rejected treatments ({resp.status_code}).")


TIDEPOOL = {"production": "https://api.tidepool.org", "integration": "https://external.integration.tidepool.org"}


async def upload_tidepool(s: AppSettings, readings: list[Reading], treatments: list[Treatment]) -> int:
    events = []
    for r in readings:
        events.append({"type": "cbg", "time": _iso(r.ts), "timezoneOffset": 0, "deviceId": DEVICE,
                       "value": r.sgv, "units": "mg/dL", "sampleInterval": 300000})
    for t in treatments:
        if t.kind == "insulin" and t.insulin:
            events.append({"type": "bolus", "subType": "normal", "time": _iso(t.ts), "timezoneOffset": 0,
                           "deviceId": DEVICE, "normal": t.insulin})
        elif t.kind == "carbs" and t.carbs:
            events.append({"type": "food", "time": _iso(t.ts), "timezoneOffset": 0, "deviceId": DEVICE,
                           "nutrition": {"carbohydrate": {"net": t.carbs, "units": "grams"}}})
    if not events:
        return 0
    async with httpx.AsyncClient(base_url=TIDEPOOL[s.tp_env], timeout=60) as c:
        r = await c.post("/auth/login", auth=(s.tp_email, s.tp_password))
        token = r.headers.get("X-Tidepool-Session-Token")
        if r.status_code != 200 or not token:
            raise RuntimeError("Tidepool login failed. Check email and password.")
        user_id = r.json()["userid"]
        h = {"X-Tidepool-Session-Token": token}
        now = datetime.now(timezone.utc)
        meta = {"client": {"name": "org.xdrip.ios.personal", "version": "1.0.0"}, "dataSetType": "normal",
                "deduplicator": {"name": "org.tidepool.deduplicator.dataset.delete.origin"},
                "deviceManufacturers": ["xDrip"], "deviceModel": "xDrip-iOS", "deviceSerialNumber": "personal",
                "deviceTags": ["cgm", "insulin-pump"], "timeProcessing": "none", "timezone": "UTC",
                "deviceId": DEVICE, "time": _iso(now), "timezoneOffset": 0,
                "computerTime": now.strftime("%Y-%m-%dT%H:%M:%S"), "deviceTime": now.strftime("%Y-%m-%dT%H:%M:%S")}
        r = await c.post(f"/dataservices/v1/users/{user_id}/data_sets", headers=h, json=meta)
        if r.status_code not in (200, 201):
            raise RuntimeError(f"Tidepool could not start an upload ({r.status_code}).")
        dataset = r.json()["data"]["uploadId"]
        try:
            for i in range(0, len(events), 1000):
                r = await c.post(f"/dataservices/v1/datasets/{dataset}/data", headers=h, json=events[i:i + 1000])
                if r.status_code not in (200, 201):
                    raise RuntimeError(f"Tidepool rejected the data ({r.status_code}).")
        finally:
            await c.put(f"/dataservices/v1/datasets/{dataset}", headers=h, json={"dataState": "closed"})
    return len(events)
