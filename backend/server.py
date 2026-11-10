import asyncio
import json
import logging
import os
import statistics
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from xml.sax.saxutils import escape

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.errors import BulkWriteError, DuplicateKeyError
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from models import (SECRET_FIELDS, AckIn, AppSettings, EmergencyLog, LocationIn, Reading,  # noqa: E402
                    ReadingBatchIn, ReadingIn, SummaryIn, Treatment, TreatmentIn)
from sources import demo_readings, direction_from_slope, fetch_source, reset_sessions  # noqa: E402
from uploads import upload_nightscout, upload_tidepool  # noqa: E402

client = AsyncIOMotorClient(os.environ["MONGO_URL"], tz_aware=True)
db = client[os.environ["DB_NAME"]]
logger = logging.getLogger("xdrip")
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

INDEXES: dict[str, list[IndexModel]] = {
    "readings": [
        IndexModel([("ts", DESCENDING)], name="ts_unique", unique=True),
        IndexModel([("ns_uploaded", ASCENDING), ("ts", DESCENDING)], name="ns_pending"),
        IndexModel([("tp_uploaded", ASCENDING), ("ts", DESCENDING)], name="tp_pending"),
        IndexModel([("source", ASCENDING)], name="source"),
    ],
    "treatments": [IndexModel([("ts", DESCENDING)], name="ts_desc")],
    "emergency_log": [IndexModel([("ts", DESCENDING)], name="ts_desc")],
    "summaries": [IndexModel([("label", ASCENDING)], name="label", unique=True)],
}

UPLOAD_WINDOW = timedelta(hours=24)  # never push more history than this to Nightscout / Tidepool
HISTORY_DAYS = 90


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)


app = FastAPI()


@app.get("/health", include_in_schema=False)
@app.head("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


api = APIRouter(prefix="/api")
now_utc = lambda: datetime.now(timezone.utc)  # noqa: E731


# ---------------- settings & state ----------------
async def get_settings() -> AppSettings:
    doc = await db.settings.find_one({"_id": "main"}, {"_id": 0})
    return AppSettings.model_validate(doc or {})


async def get_state(key: str) -> dict:
    return await db.state.find_one({"_id": key}, {"_id": 0}) or {}


async def set_state(key: str, values: dict) -> None:
    await db.state.update_one({"_id": key}, {"$set": values}, upsert=True)


async def insert_readings(items: list[dict], source: str) -> int:
    if not items:
        return 0
    docs = [Reading(ts=i["ts"], sgv=i["sgv"], direction=i["direction"], source=source).to_mongo() for i in items]
    try:
        res = await db.readings.insert_many(docs, ordered=False)
        return len(res.inserted_ids)
    except BulkWriteError as e:
        return e.details.get("nInserted", 0)


async def latest_reading() -> Optional[Reading]:
    return Reading.from_mongo(await db.readings.find_one({}, sort=[("ts", -1)]))


# ---------------- sync loop ----------------
async def sync_once(force: bool = False) -> dict:
    s = await get_settings()
    now = now_utc()
    last = await latest_reading()
    sync = await get_state("sync")
    error = None
    added = 0
    try:
        if s.source == "demo":
            after = last.ts if last else now - timedelta(days=HISTORY_DAYS)
            added = await insert_readings(demo_readings(after, now), "demo")
        elif s.source in ("nightscout", "dexcom", "libre"):
            last_fetch = sync.get("last_fetch")
            if force or not last_fetch or now - last_fetch >= timedelta(minutes=2):
                since = last.ts if last else now - timedelta(days=1)
                added = await insert_readings(await fetch_source(s, since), s.source)
                await set_state("sync", {"last_fetch": now})
    except Exception as exc:
        error = str(exc)[:300]
        logger.warning("source sync failed: %s", error)

    upload_errors = {}
    if s.ns_upload and s.ns_url and s.source != "nightscout":
        try:
            await push_nightscout(s)
        except Exception as exc:
            upload_errors["nightscout"] = str(exc)[:300]
    if s.tp_upload and s.tp_email and s.tp_password:
        tp_last = sync.get("tp_last")
        if force or not tp_last or now - tp_last >= timedelta(minutes=15):
            try:
                await push_tidepool(s)
                await set_state("sync", {"tp_last": now})
            except Exception as exc:
                upload_errors["tidepool"] = str(exc)[:300]

    await set_state("sync", {"last_sync": now, "last_error": error, "added": added, "upload_errors": upload_errors})
    await check_alarms(s)
    return {"added": added, "error": error, "upload_errors": upload_errors}


async def push_nightscout(s: AppSettings) -> int:
    since = now_utc() - UPLOAD_WINDOW
    readings = [Reading.from_mongo(d) async for d in
                db.readings.find({"ns_uploaded": False, "ts": {"$gte": since}}).sort("ts", 1).limit(1000)]
    treatments = [Treatment.from_mongo(d) async for d in
                  db.treatments.find({"ns_uploaded": False, "ts": {"$gte": since}})]
    if not readings and not treatments:
        return 0
    await upload_nightscout(s, readings, treatments)
    from bson import ObjectId
    await db.readings.update_many({"_id": {"$in": [ObjectId(r.id) for r in readings]}}, {"$set": {"ns_uploaded": True}})
    await db.treatments.update_many({"_id": {"$in": [ObjectId(t.id) for t in treatments]}}, {"$set": {"ns_uploaded": True}})
    return len(readings) + len(treatments)


async def push_tidepool(s: AppSettings) -> int:
    since = now_utc() - UPLOAD_WINDOW
    readings = [Reading.from_mongo(d) async for d in
                db.readings.find({"tp_uploaded": False, "ts": {"$gte": since}}).sort("ts", 1).limit(3000)]
    treatments = [Treatment.from_mongo(d) async for d in
                  db.treatments.find({"tp_uploaded": False, "ts": {"$gte": since}})]
    count = await upload_tidepool(s, readings, treatments)
    from bson import ObjectId
    await db.readings.update_many({"_id": {"$in": [ObjectId(r.id) for r in readings]}}, {"$set": {"tp_uploaded": True}})
    await db.treatments.update_many({"_id": {"$in": [ObjectId(t.id) for t in treatments]}}, {"$set": {"tp_uploaded": True}})
    return count


async def sync_loop():
    while True:
        try:
            await sync_once()
        except Exception as exc:
            logger.exception("sync loop error: %s", exc)
        await asyncio.sleep(60)


# ---------------- alarms & emergency ----------------
ALARM_LABELS = {"extreme_low": "EXTREME LOW", "urgent_low": "URGENT LOW", "low": "LOW", "high": "HIGH",
                "urgent_high": "URGENT HIGH", "missed": "MISSED READINGS"}
def alarm_label(kind: str, s: AppSettings) -> str:
    if kind.startswith("custom:"):
        ga = next((g for g in s.glucose_alarms if f"custom:{g.id}" == kind), None)
        return ga.title.upper() if ga else "ALARM"
    return ALARM_LABELS.get(kind, kind.upper())


def snooze_for(kind: str, s: AppSettings) -> int:
    if kind.startswith("custom:"):
        ga = next((g for g in s.glucose_alarms if f"custom:{g.id}" == kind), None)
        return ga.snooze_minutes if ga else s.snooze_minutes
    cfg = s.alarm_sounds.get(kind)
    return cfg.snooze_minutes if cfg else s.snooze_minutes


EXTREME_LOW = 50  # mg/dL (2.8 mmol/L)


def classify(sgv: int, s: AppSettings) -> Optional[str]:
    if sgv < EXTREME_LOW and s.alarm_extreme_low: return "extreme_low"
    if sgv <= s.urgent_low: return "urgent_low"
    if sgv < s.low: return "low"
    if sgv >= s.urgent_high: return "urgent_high"
    if sgv > s.high: return "high"
    return None


def fmt_value(sgv: int, s: AppSettings) -> str:
    return f"{sgv / 18.0182:.1f} mmol/L" if s.unit == "mmol" else f"{sgv} mg/dL"


ARROW_WORDS = {"DoubleUp": "rising fast", "SingleUp": "rising", "FortyFiveUp": "rising slowly", "Flat": "steady",
               "FortyFiveDown": "falling slowly", "SingleDown": "falling", "DoubleDown": "falling fast"}


async def check_alarms(s: AppSettings) -> None:
    now = now_utc()
    last = await latest_reading()
    level = None
    if last:
        stale = now - last.ts > timedelta(minutes=s.missed_minutes)
        if stale and s.source != "manual":
            level = "missed" if s.alarm_missed else None
        elif not stale:
            level = classify(last.sgv, s)
            if level and not getattr(s, f"alarm_{level}"):
                level = None
            if not level:  # user-made glucose alarms, checked after the presets
                for ga in s.glucose_alarms:
                    if ga.enabled and ((ga.direction == "below" and last.sgv < ga.value) or
                                       (ga.direction == "above" and last.sgv > ga.value)):
                        level = f"custom:{ga.id}"
                        break
    alarm = await get_state("alarm")
    reset = {"emergency_sent_at": None, "em_sms_sent_at": None, "em_call_sent_at": None}
    if not level:
        if alarm.get("type"):
            await set_state("alarm", {"type": None, "started_at": None, **reset})
        return
    if alarm.get("type") != level:
        alarm = {"type": level, "started_at": now, **reset,
                 "snoozed_until": alarm.get("snoozed_until") if alarm.get("snoozed_type") == level else None,
                 "snoozed_type": alarm.get("snoozed_type")}
        await set_state("alarm", alarm)

    snoozed = alarm.get("snoozed_until") and alarm["snoozed_until"] > now and alarm.get("snoozed_type") == level
    em_match = level in s.em_triggers or (level == "extreme_low" and bool({"urgent_low", "low"} & set(s.em_triggers)))
    if (s.em_enabled and s.source != "demo" and em_match and not snoozed and s.em_contacts
            and now - alarm["started_at"] >= timedelta(minutes=s.em_delay_minutes)):
        # Resend each channel on its own interval while glucose stays at this level.
        due = set()
        for ch in ("sms", "call"):
            sent = alarm.get(f"em_{ch}_sent_at")
            if getattr(s, f"em_{ch}") and (not sent or now - sent >= timedelta(minutes=getattr(s, f"em_{ch}_repeat_minutes"))):
                due.add(ch)
        if due:
            await set_state("alarm", {"emergency_sent_at": now, **{f"em_{ch}_sent_at": now for ch in due}})
            try:
                await send_emergency(s, last, test=False, channels=due, level=level)
            except Exception as exc:
                logger.error("emergency send failed: %s", getattr(exc, "detail", exc))


LEVEL_WORDS = {"extreme_low": "extremely low", "urgent_low": "very low", "low": "low", "high": "high", "urgent_high": "very high"}


async def build_message(s: AppSettings, reading: Optional[Reading], test: bool, level: str) -> tuple[str, str]:
    who = s.em_name or "Your contact"
    if reading:
        val = fmt_value(reading.sgv, s)
        trend = ARROW_WORDS.get(reading.direction, "")
        mins = int((now_utc() - reading.ts).total_seconds() // 60)
        glucose = f"glucose is {val}{', ' + trend if trend else ''} ({mins} min ago)"
    else:
        glucose = "glucose is unknown"
    loc_text = ""
    if s.em_location:
        loc = await get_state("location")
        if loc.get("lat") is not None:
            age = int((now_utc() - loc["ts"]).total_seconds() // 60)
            loc_text = f" Location ({age} min ago): https://maps.google.com/?q={loc['lat']:.5f},{loc['lon']:.5f}"
    prefix = "TEST - " if test else "EMERGENCY: "
    word = LEVEL_WORDS.get(level, "glucose")
    sms = f"{prefix}{who}'s {glucose}. The {word} glucose alarm was not acknowledged.{loc_text}"
    speech = (f"{'This is a test. ' if test else 'Emergency alert. '}{who}'s {glucose}. "
              f"The {word} glucose alarm was not acknowledged. Please check on them now.")
    return sms, speech


def _in_hours(sched, now_local: datetime) -> bool:
    if sched.mode != "hours":
        return True
    t = now_local.strftime("%H:%M")
    if sched.start == sched.end:
        return True
    if sched.start < sched.end:
        return sched.start <= t < sched.end
    return t >= sched.start or t < sched.end  # overnight, e.g. 22:00-07:00


def channel_active(s: AppSettings, contact, channel: str, now_local: datetime) -> tuple[bool, str]:
    if not getattr(s, f"em_{channel}"):
        return False, "off"
    own = getattr(contact, channel)
    if not own.enabled:
        return False, "off for this contact"
    sched = getattr(s, f"em_{channel}_schedule") if own.mode == "default" else own
    if not _in_hours(sched, now_local):
        return False, f"outside {sched.start}-{sched.end}"
    return True, ""


def local_now(s: AppSettings) -> datetime:
    from zoneinfo import ZoneInfo
    try:
        return now_utc().astimezone(ZoneInfo(s.tz))
    except Exception:
        return now_utc()


async def send_emergency(s: AppSettings, reading: Optional[Reading], test: bool,
                         channels: frozenset | set = frozenset({"sms", "call"}), level: str = "urgent_low") -> list[str]:
    sid, token, sender = (os.environ.get(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"))
    if not (sid and token and sender):
        raise HTTPException(400, "Text and call service is not set up yet (Twilio keys missing).")
    if not s.em_contacts:
        raise HTTPException(400, "Add at least one emergency contact first.")
    from twilio.rest import Client
    tw = Client(sid, token)
    sms, speech = await build_message(s, reading, test, level)
    now_local = local_now(s)
    results = []
    for c in s.em_contacts:
        sms_on, sms_why = channel_active(s, c, "sms", now_local)
        call_on, call_why = channel_active(s, c, "call", now_local)
        sms_on, call_on = sms_on and "sms" in channels, call_on and "call" in channels
        if sms_on:
            try:
                await asyncio.to_thread(tw.messages.create, to=c.phone, from_=sender, body=sms)
                results.append(f"Text sent to {c.name}")
            except Exception as exc:
                results.append(f"Text to {c.name} failed: {str(exc)[:120]}")
        elif s.em_sms and "sms" in channels:
            results.append(f"No text to {c.name} ({sms_why})")
        if call_on:
            twiml = f'<Response><Say loop="3">{escape(speech)}</Say></Response>'
            try:
                await asyncio.to_thread(tw.calls.create, to=c.phone, from_=sender, twiml=twiml)
                results.append(f"Call placed to {c.name}")
            except Exception as exc:
                results.append(f"Call to {c.name} failed: {str(exc)[:120]}")
        elif s.em_call and "call" in channels:
            results.append(f"No call to {c.name} ({call_why})")
    await db.emergency_log.insert_one(EmergencyLog(ts=now_utc(), test=test, message=sms, results=results).to_mongo())
    return results


# ---------------- routes ----------------
@api.get("/")
async def root():
    return {"message": "xDrip API"}


@api.get("/settings")
async def read_settings():
    return (await get_settings()).public()


@api.put("/settings")
async def update_settings(patch: dict):
    current = await get_settings()
    data = current.model_dump()
    for k, v in patch.items():
        if k not in data:
            continue
        if k in SECRET_FIELDS and not v:
            continue  # empty means keep the saved secret
        data[k] = v
    try:
        new = AppSettings.model_validate(data)
    except Exception as exc:
        raise HTTPException(422, f"Invalid settings: {exc}")
    if not (new.urgent_low < new.low < new.high < new.urgent_high):
        raise HTTPException(422, "Thresholds must go: urgent low < low < high < urgent high.")
    if not (40 <= new.target_low < new.target_high <= 400):
        raise HTTPException(422, "Target range: low must be below high.")
    await db.settings.update_one({"_id": "main"}, {"$set": new.model_dump()}, upsert=True)
    if new.source != current.source:
        reset_sessions()
        if current.source == "demo":
            await db.readings.delete_many({"source": "demo"})
        await set_state("sync", {"last_fetch": None, "last_error": None})
        await set_state("alarm", {"type": None, "started_at": None, "emergency_sent_at": None})
    if new.source != current.source or any(patch.get(k) for k in SECRET_FIELDS) or new.ns_url != current.ns_url:
        reset_sessions()
        asyncio.create_task(sync_once(force=True))
    return new.public()


@api.get("/status")
async def status():
    s = await get_settings()
    last = await latest_reading()
    reading, delta = None, None
    if last:
        prev = Reading.from_mongo(await db.readings.find_one({"ts": {"$lt": last.ts, "$gte": last.ts - timedelta(minutes=16)}},
                                                            sort=[("ts", -1)]))
        if prev:
            minutes = max(1.0, (last.ts - prev.ts).total_seconds() / 60)
            delta = round((last.sgv - prev.sgv) * 5 / minutes, 1)
        reading = {"ts": last.ts, "sgv": last.sgv, "direction": last.direction, "source": last.source}
    sync = await get_state("sync")
    alarm = await get_state("alarm")
    active = None
    if alarm.get("type"):
        snoozed = bool(alarm.get("snoozed_until") and alarm["snoozed_until"] > now_utc()
                       and alarm.get("snoozed_type") == alarm["type"])
        active = {"type": alarm["type"], "label": alarm_label(alarm["type"], s), "started_at": alarm["started_at"],
                  "snooze_minutes": snooze_for(alarm["type"], s),
                  "snoozed": snoozed, "snoozed_until": alarm.get("snoozed_until") if snoozed else None,
                  "emergency_sent_at": alarm.get("emergency_sent_at")}
    sensor = None
    if s.sensor_started_at:
        sensor = {"started_at": s.sensor_started_at,
                  "ends_at": s.sensor_started_at + timedelta(days=s.sensor_days), "days": s.sensor_days}
    return {"reading": reading, "delta": delta, "source": s.source, "unit": s.unit, "sensor": sensor,
            "last_sync": sync.get("last_sync"), "last_error": sync.get("last_error"),
            "upload_errors": sync.get("upload_errors") or {}, "alarm": active,
            "thresholds": {"urgent_low": s.urgent_low, "low": s.low, "high": s.high, "urgent_high": s.urgent_high,
                           "target_low": s.target_low, "target_high": s.target_high}}


@api.get("/readings")
async def list_readings(start: datetime, end: Optional[datetime] = None, bucket: int = Query(0, ge=0, le=240)):
    end = end or now_utc()
    if end - start > timedelta(days=HISTORY_DAYS + 1):
        raise HTTPException(400, "Range too large")
    cur = db.readings.find({"ts": {"$gte": start, "$lte": end}}, {"_id": 0, "ts": 1, "sgv": 1, "direction": 1}).sort("ts", 1)
    rows = await cur.to_list(None)
    if not bucket:
        return [{"ts": r["ts"], "sgv": r["sgv"], "direction": r.get("direction", "NONE")} for r in rows]
    size = bucket * 60
    groups: dict[int, list[int]] = {}
    for r in rows:
        groups.setdefault(int(r["ts"].timestamp()) // size, []).append(r["sgv"])
    return [{"ts": datetime.fromtimestamp(k * size + size / 2, timezone.utc), "sgv": round(sum(v) / len(v)),
             "direction": "NONE"} for k, v in sorted(groups.items())]


@api.post("/readings")
async def add_reading(body: ReadingIn):
    ts = (body.ts or now_utc()).astimezone(timezone.utc)
    prev = await db.readings.find_one({"ts": {"$lt": ts, "$gte": ts - timedelta(minutes=30)}}, sort=[("ts", -1)])
    direction = "NONE"
    if prev:
        minutes = max(1.0, (ts - prev["ts"]).total_seconds() / 60)
        direction = direction_from_slope((body.sgv - prev["sgv"]) / minutes)
    r = Reading(ts=ts, sgv=body.sgv, direction=direction, source="manual")
    try:
        res = await db.readings.insert_one(r.to_mongo())
    except DuplicateKeyError:
        raise HTTPException(409, "A reading already exists at this time.")
    r.id = str(res.inserted_id)
    asyncio.create_task(check_alarms(await get_settings()))
    return r.model_dump(exclude={"ns_uploaded", "tp_uploaded"})


@api.post("/readings/batch")
async def add_reading_batch(body: ReadingBatchIn):
    """Readings collected by the phone from a Bluetooth sensor (Master mode)."""
    items = [{"ts": r.ts.astimezone(timezone.utc), "sgv": r.sgv, "direction": r.direction} for r in body.readings]
    added = await insert_readings(items, "bluetooth")
    asyncio.create_task(check_alarms(await get_settings()))
    return {"added": added}


@api.get("/treatments")
async def list_treatments(start: datetime, end: Optional[datetime] = None):
    end = end or now_utc()
    docs = await db.treatments.find({"ts": {"$gte": start, "$lte": end}}).sort("ts", -1).to_list(2000)
    return [Treatment.from_mongo(d).model_dump(exclude={"ns_uploaded", "tp_uploaded"}) for d in docs]


@api.post("/treatments")
async def add_treatment(body: TreatmentIn):
    if body.kind == "insulin" and not body.insulin:
        raise HTTPException(422, "Enter insulin units.")
    if body.kind == "carbs" and not body.carbs:
        raise HTTPException(422, "Enter grams of carbs.")
    if body.kind == "note" and not (body.note or "").strip():
        raise HTTPException(422, "Write a note.")
    t = Treatment(ts=(body.ts or now_utc()).astimezone(timezone.utc), kind=body.kind,
                  insulin=body.insulin if body.kind == "insulin" else None,
                  carbs=body.carbs if body.kind == "carbs" else None, note=(body.note or "").strip() or None)
    res = await db.treatments.insert_one(t.to_mongo())
    t.id = str(res.inserted_id)
    return t.model_dump(exclude={"ns_uploaded", "tp_uploaded"})


@api.delete("/treatments/{tid}")
async def delete_treatment(tid: str):
    from bson import ObjectId
    from bson.errors import InvalidId
    try:
        oid = ObjectId(tid)
    except InvalidId:
        raise HTTPException(404, "Not found")
    res = await db.treatments.delete_one({"_id": oid})
    if not res.deleted_count:
        raise HTTPException(404, "Not found")
    return {"ok": True}


async def compute_stats(start: datetime, end: datetime, s: AppSettings) -> dict:
    rows = await db.readings.find({"ts": {"$gte": start, "$lte": end}}, {"_id": 0, "sgv": 1}).to_list(None)
    vals = [r["sgv"] for r in rows]
    if not vals:
        return {"count": 0}
    n = len(vals)
    avg = sum(vals) / n
    sd = statistics.pstdev(vals) if n > 1 else 0.0
    pct = lambda c: round(100 * c / n, 1)  # noqa: E731
    expected = max(1.0, (min(end, now_utc()) - start).total_seconds() / 300)
    return {
        "count": n, "average": round(avg, 1), "median": statistics.median(vals), "sd": round(sd, 1),
        "cv": round(100 * sd / avg, 1) if avg else 0, "gmi": round(3.31 + 0.02392 * avg, 1),
        "a1c": round((avg + 46.7) / 28.7, 1), "min": min(vals), "max": max(vals),
        "capture": min(100.0, round(100 * n / expected, 1)),
        "tir": {
            "very_low": pct(sum(v < 54 for v in vals)),
            "low": pct(sum(54 <= v < s.target_low for v in vals)),
            "in_range": pct(sum(s.target_low <= v <= s.target_high for v in vals)),
            "high": pct(sum(s.target_high < v <= 250 for v in vals)),
            "very_high": pct(sum(v > 250 for v in vals)),
        },
    }


@api.get("/stats")
async def stats(start: datetime, end: Optional[datetime] = None):
    s = await get_settings()
    return await compute_stats(start, end or now_utc(), s)


@api.post("/sync")
async def sync_now():
    return await sync_once(force=True)


@api.post("/nightscout/upload")
async def ns_upload_now():
    s = await get_settings()
    if not s.ns_url:
        raise HTTPException(400, "Add your Nightscout URL first.")
    try:
        return {"uploaded": await push_nightscout(s)}
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except Exception:
        raise HTTPException(400, "Could not reach your Nightscout site. Check the URL.")


@api.post("/tidepool/upload")
async def tp_upload_now():
    s = await get_settings()
    if not (s.tp_email and s.tp_password):
        raise HTTPException(400, "Add your Tidepool email and password first.")
    try:
        return {"uploaded": await push_tidepool(s)}
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except Exception:
        raise HTTPException(400, "Could not reach Tidepool.")


@api.post("/alarm/ack")
async def ack_alarm(body: AckIn):
    s = await get_settings()
    alarm = await get_state("alarm")
    if not alarm.get("type"):
        return {"ok": True}
    until = now_utc() + timedelta(minutes=body.minutes or snooze_for(alarm["type"], s))
    await set_state("alarm", {"snoozed_until": until, "snoozed_type": alarm["type"]})
    return {"ok": True, "snoozed_until": until}


@api.post("/location")
async def report_location(body: LocationIn):
    await set_state("location", {"lat": body.lat, "lon": body.lon, "ts": now_utc()})
    return {"ok": True}


@api.post("/emergency/test")
async def emergency_test():
    s = await get_settings()
    results = await send_emergency(s, await latest_reading(), test=True)
    return {"results": results}


@api.get("/emergency/log")
async def emergency_log():
    docs = await db.emergency_log.find().sort("ts", -1).limit(20).to_list(20)
    return [EmergencyLog.from_mongo(d).model_dump() for d in docs]


@api.get("/ai/summary")
async def get_summary(label: str):
    doc = await db.summaries.find_one({"label": label}, {"_id": 0})
    return doc or {"label": label, "text": None}


@api.post("/ai/summary")
async def ai_summary(body: SummaryIn):
    from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage
    s = await get_settings()
    st = await compute_stats(body.start, body.end, s)
    if not st.get("count"):
        raise HTTPException(400, "No glucose readings for this day yet.")
    rows = await db.readings.find({"ts": {"$gte": body.start, "$lte": body.end}}, {"_id": 0, "ts": 1, "sgv": 1}).to_list(None)
    hourly: dict[int, list[int]] = {}
    for r in rows:
        hourly.setdefault(int((r["ts"] - body.start).total_seconds() // 3600), []).append(r["sgv"])
    hours = ", ".join(f"h{h}:{round(sum(v) / len(v))}" for h, v in sorted(hourly.items()))
    tdocs = await db.treatments.find({"ts": {"$gte": body.start, "$lte": body.end}}).sort("ts", 1).to_list(200)
    treats = "; ".join(f"+{int((d['ts'] - body.start).total_seconds() // 60)}min {d['kind']} "
                       f"{d.get('insulin') or d.get('carbs') or ''} {d.get('note') or ''}".strip() for d in tdocs) or "none"
    unit = "mmol/L" if s.unit == "mmol" else "mg/dL"
    prompt = (f"Day: {body.label}. Glucose values in mg/dL; reply using {unit} "
              f"(divide by 18 for mmol/L). Target {s.low}-{s.high} mg/dL.\n"
              f"Stats: {json.dumps(st)}\nHourly averages from start of day: {hours}\nTreatments (minutes from start): {treats}")
    chat = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=f"summary-{body.label}-{now_utc().timestamp()}",
                   system_message=("You write a short, friendly daily glucose recap for a person with diabetes. "
                                   "4-6 short sentences, plain words, no markdown, no headings. Mention time in range, "
                                   "the highest and lowest periods with approximate times of day, and any pattern around "
                                   "meals or insulin. Do not give medical advice or dosing changes; suggest talking to "
                                   "their care team if something looks concerning.")
                   ).with_model("anthropic", "claude-sonnet-5-5")

    async def gen():
        text = ""
        try:
            async for ev in chat.stream_message(UserMessage(text=prompt)):
                if isinstance(ev, TextDelta):
                    text += ev.content
                    yield f"data: {json.dumps({'delta': ev.content})}\n\n"
                elif isinstance(ev, StreamDone):
                    break
            await db.summaries.update_one({"label": body.label},
                                          {"$set": {"label": body.label, "text": text, "created_at": now_utc()}},
                                          upsert=True)
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:
            logger.error("ai summary failed: %s", exc)
            yield f"data: {json.dumps({'error': 'The summary could not be written right now. Try again.'})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    app.state.index_task = asyncio.create_task(ensure_indexes())
    app.state.sync_task = asyncio.create_task(sync_loop())


@app.on_event("shutdown")
async def shutdown():
    for t in (app.state.index_task, app.state.sync_task):
        t.cancel()
        with suppress(asyncio.CancelledError):
            await t
    client.close()
