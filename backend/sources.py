"""Glucose data sources: demo generator, Nightscout, Dexcom Share, LibreLinkUp."""
import hashlib
import math
import re
from datetime import datetime, timezone

import httpx

from models import AppSettings

DIRECTIONS = ["NONE", "DoubleUp", "SingleUp", "FortyFiveUp", "Flat", "FortyFiveDown",
              "SingleDown", "DoubleDown", "NOT COMPUTABLE", "RATE OUT OF RANGE"]


def direction_from_slope(per_min: float) -> str:
    if per_min > 3: return "DoubleUp"
    if per_min > 2: return "SingleUp"
    if per_min > 1: return "FortyFiveUp"
    if per_min >= -1: return "Flat"
    if per_min >= -2: return "FortyFiveDown"
    if per_min >= -3: return "SingleDown"
    return "DoubleDown"


# ---------------- Demo ----------------
def demo_value(t: float) -> int:
    h = t / 3600.0
    v = 125 + 40 * math.sin(2 * math.pi * h / 6.3) + 22 * math.sin(2 * math.pi * h / 1.7 + 1.3)
    v += 55 * max(0.0, math.sin(2 * math.pi * h / 24 + 0.6)) ** 6  # daily meal spike
    v -= 70 * max(0.0, math.sin(2 * math.pi * h / 31 + 2.0)) ** 10  # occasional lows
    noise = int(hashlib.md5(str(int(t // 300)).encode()).hexdigest()[:4], 16) / 65535.0
    v += (noise - 0.5) * 8
    return int(max(40, min(400, round(v))))


def demo_readings(after: datetime, now: datetime) -> list[dict]:
    step = 300
    start = (int(after.timestamp()) // step + 1) * step
    out = []
    t = start
    while t <= now.timestamp():
        v = demo_value(t)
        prev = demo_value(t - step)
        out.append({"ts": datetime.fromtimestamp(t, timezone.utc), "sgv": v,
                    "direction": direction_from_slope((v - prev) / 5.0)})
        t += step
    return out


# ---------------- Nightscout ----------------
TOKEN_RE = re.compile(r"^[a-z0-9_]+-[0-9a-f]{16}$")


def ns_auth(secret: str) -> tuple[dict, dict]:
    if not secret:
        return {}, {}
    if TOKEN_RE.match(secret):
        return {}, {"token": secret}
    return {"api-secret": hashlib.sha1(secret.encode()).hexdigest()}, {}


async def fetch_nightscout(s: AppSettings, since: datetime) -> list[dict]:
    headers, params = ns_auth(s.ns_secret)
    params = {**params, "count": 2000, "find[date][$gt]": int(since.timestamp() * 1000)}
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{s.ns_url.rstrip('/')}/api/v1/entries/sgv.json", headers=headers, params=params)
    r.raise_for_status()
    out = []
    for e in r.json():
        if e.get("sgv") is None or e.get("date") is None:
            continue
        out.append({"ts": datetime.fromtimestamp(e["date"] / 1000, timezone.utc), "sgv": int(e["sgv"]),
                    "direction": e.get("direction") or "NONE"})
    return out


# ---------------- Dexcom Share ----------------
DEXCOM = {
    "us": ("https://share2.dexcom.com/ShareWebServices/Services", "d89443d2-327c-4a6f-89e5-496bbb0317db"),
    "ous": ("https://shareous1.dexcom.com/ShareWebServices/Services", "d89443d2-327c-4a6f-89e5-496bbb0317db"),
    "jp": ("https://share.dexcom.jp/ShareWebServices/Services", "d8665ade-9673-4e27-9ff6-92db4ce13d13"),
}
_dexcom_session: dict = {}


async def _dexcom_login(c: httpx.AsyncClient, s: AppSettings) -> str:
    base, app_id = DEXCOM[s.dexcom_region]
    r = await c.post(f"{base}/General/AuthenticatePublisherAccount",
                     json={"accountName": s.dexcom_username, "password": s.dexcom_password, "applicationId": app_id})
    if r.status_code != 200:
        raise RuntimeError("Dexcom login failed. Check username, password and region.")
    account_id = r.json()
    r = await c.post(f"{base}/General/LoginPublisherAccountById",
                     json={"accountId": account_id, "password": s.dexcom_password, "applicationId": app_id})
    if r.status_code != 200:
        raise RuntimeError("Dexcom login failed.")
    session = r.json()
    _dexcom_session.update({"key": (s.dexcom_username, s.dexcom_region), "id": session})
    return session


async def fetch_dexcom(s: AppSettings, since: datetime) -> list[dict]:
    base, _ = DEXCOM[s.dexcom_region]
    minutes = int(min(1440, max(10, (datetime.now(timezone.utc) - since).total_seconds() / 60 + 5)))
    async with httpx.AsyncClient(timeout=20) as c:
        session = _dexcom_session.get("id") if _dexcom_session.get("key") == (s.dexcom_username, s.dexcom_region) else None
        if not session:
            session = await _dexcom_login(c, s)
        params = {"minutes": minutes, "maxCount": 288}
        r = await c.post(f"{base}/Publisher/ReadPublisherLatestGlucoseValues", params={**params, "sessionId": session})
        if r.status_code != 200:
            session = await _dexcom_login(c, s)
            r = await c.post(f"{base}/Publisher/ReadPublisherLatestGlucoseValues", params={**params, "sessionId": session})
        r.raise_for_status()
    out = []
    for e in r.json():
        ms = int(re.search(r"\d+", e["WT"]).group())
        trend = e.get("Trend")
        direction = DIRECTIONS[trend] if isinstance(trend, int) and 0 <= trend < len(DIRECTIONS) else (trend or "NONE")
        out.append({"ts": datetime.fromtimestamp(ms / 1000, timezone.utc), "sgv": int(e["Value"]), "direction": direction})
    return out


# ---------------- LibreLinkUp ----------------
LLU_HEADERS = {"product": "llu.ios", "version": "4.16.0", "Accept-Encoding": "gzip",
               "Cache-Control": "no-cache", "Content-Type": "application/json"}
LLU_TREND = {1: "SingleDown", 2: "FortyFiveDown", 3: "Flat", 4: "FortyFiveUp", 5: "SingleUp"}
_llu: dict = {}


async def _llu_login(c: httpx.AsyncClient, s: AppSettings) -> None:
    base = "https://api.libreview.io"
    for _ in range(2):
        r = await c.post(f"{base}/llu/auth/login", headers=LLU_HEADERS,
                         json={"email": s.libre_email, "password": s.libre_password})
        d = r.json()
        data = d.get("data") or {}
        if data.get("redirect"):
            base = f"https://api-{data['region']}.libreview.io"
            continue
        if d.get("status") != 0 or "authTicket" not in data:
            raise RuntimeError("LibreLinkUp login failed. Check email/password and accept terms in the LibreLinkUp app.")
        _llu.update({"key": s.libre_email, "base": base, "token": data["authTicket"]["token"],
                     "account": hashlib.sha256(data["user"]["id"].encode()).hexdigest()})
        return
    raise RuntimeError("LibreLinkUp region redirect failed.")


def _llu_ts(item: dict) -> datetime:
    return datetime.strptime(item["FactoryTimestamp"], "%m/%d/%Y %I:%M:%S %p").replace(tzinfo=timezone.utc)


async def fetch_libre(s: AppSettings, since: datetime) -> list[dict]:
    async with httpx.AsyncClient(timeout=20) as c:
        if _llu.get("key") != s.libre_email:
            await _llu_login(c, s)

        def h():
            return {**LLU_HEADERS, "Authorization": f"Bearer {_llu['token']}", "Account-Id": _llu["account"]}

        r = await c.get(f"{_llu['base']}/llu/connections", headers=h())
        if r.status_code == 401:
            await _llu_login(c, s)
            r = await c.get(f"{_llu['base']}/llu/connections", headers=h())
        r.raise_for_status()
        conns = r.json().get("data") or []
        if not conns:
            raise RuntimeError("No LibreLinkUp connection. Share your data with this LibreLinkUp account first.")
        r = await c.get(f"{_llu['base']}/llu/connections/{conns[0]['patientId']}/graph", headers=h())
        r.raise_for_status()
    data = r.json()["data"]
    out = []
    for g in data.get("graphData") or []:
        out.append({"ts": _llu_ts(g), "sgv": int(g["ValueInMgPerDl"]), "direction": "NONE"})
    cur = (data.get("connection") or {}).get("glucoseMeasurement")
    if cur:
        out.append({"ts": _llu_ts(cur), "sgv": int(cur["ValueInMgPerDl"]),
                    "direction": LLU_TREND.get(cur.get("TrendArrow"), "NONE")})
    return [o for o in out if o["ts"] > since]


async def fetch_source(s: AppSettings, since: datetime) -> list[dict]:
    if s.source == "nightscout":
        if not s.ns_url:
            raise RuntimeError("Add your Nightscout URL in Settings.")
        return await fetch_nightscout(s, since)
    if s.source == "dexcom":
        if not (s.dexcom_username and s.dexcom_password):
            raise RuntimeError("Add your Dexcom Share login in Settings.")
        return await fetch_dexcom(s, since)
    if s.source == "libre":
        if not (s.libre_email and s.libre_password):
            raise RuntimeError("Add your LibreLinkUp login in Settings.")
        return await fetch_libre(s, since)
    return []


def reset_sessions() -> None:
    _dexcom_session.clear()
    _llu.clear()
