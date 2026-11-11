"""Follower sources reverse-engineered by the open-source Nightscout team (github.com/nightscout/nocturne):
twiist Insight (follower login), Medtronic CareLink (care partner / patient), Glooko (Omnipod DISCOVER)."""
import base64
import hashlib
import json
import re
import secrets
import struct
import time
import zlib
from datetime import datetime, timedelta, timezone
from html import unescape
from typing import Awaitable, Callable, Optional
from urllib.parse import parse_qs, urlencode, urljoin, urlparse
from zoneinfo import ZoneInfo

import httpx

from auth import CURRENT_UID
from models import AppSettings

Save = Callable[..., Awaitable[None]]
TREND = {"UP": "SingleUp", "DOWN": "SingleDown", "DOUBLE_UP": "DoubleUp", "DOUBLE_DOWN": "DoubleDown",
         "FORTY_FIVE_UP": "FortyFiveUp", "FORTY_FIVE_DOWN": "FortyFiveDown", "UP_DOUBLE": "DoubleUp",
         "UP_TRIPLE": "DoubleUp", "DOWN_DOUBLE": "DoubleDown", "DOWN_TRIPLE": "DoubleDown", "FLAT": "Flat",
         "SINGLEUP": "SingleUp", "SINGLEDOWN": "SingleDown", "DOUBLEUP": "DoubleUp", "DOUBLEDOWN": "DoubleDown",
         "FORTYFIVEUP": "FortyFiveUp", "FORTYFIVEDOWN": "FortyFiveDown", "NONE": "NONE"}


def trend(v: Optional[str]) -> str:
    return TREND.get((v or "").upper().replace(" ", ""), "NONE")


_tokens: dict = {}  # (service, account) -> (token, expires_at, extra)


def _key(*parts):
    return (CURRENT_UID.get(None), *parts)


def _cached(key):
    t = _tokens.get(key)
    return t if t and t[1] > time.time() else None


# ---------------- twiist Insight ----------------
TWIIST_API = "https://follower-service.mytwiistportal.com"
TWIIST_COGNITO = "https://cognito-idp.us-east-1.amazonaws.com/"
TWIIST_CLIENT = "65ev2vbkr2mle7uu4cqkn7ohgl"
TWIIST_UA = "twiist insiight/1.0.2 CFNetwork/1568.100.1.2.3 Darwin/24.0.0"
TWIIST_EPOCH = datetime(2008, 1, 1, tzinfo=timezone.utc)


async def _twiist_token(c: httpx.AsyncClient, s: AppSettings) -> str:
    key = _key("twiist", s.twiist_username.lower())
    if (t := _cached(key)):
        return t[0]
    r = await c.post(TWIIST_COGNITO, content=json.dumps({
        "AuthFlow": "USER_PASSWORD_AUTH", "ClientId": TWIIST_CLIENT,
        "AuthParameters": {"USERNAME": s.twiist_username, "PASSWORD": s.twiist_password}}),
        headers={"Content-Type": "application/x-amz-json-1.1",
                 "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth"})
    if r.status_code == 400 and any(x in r.text for x in ("NotAuthorized", "UserNotFound")):
        raise RuntimeError("twiist login failed. Check the follower email and password.")
    if r.status_code != 200:
        raise RuntimeError(f"twiist login failed ({r.status_code}).")
    res = (r.json() or {}).get("AuthenticationResult")
    if not res:
        raise RuntimeError("twiist asked for an extra sign-in step. Sign in once in the twiist insiight app, then try again.")
    _tokens[key] = (res["AccessToken"], time.time() + 55 * 60, None)
    return res["AccessToken"]


def twiist_glucose(blob: Optional[str]) -> list[tuple[datetime, float]]:
    if not blob:
        return []
    raw = zlib.decompress(base64.b64decode(blob), -15)
    if len(raw) % 8:
        return []
    out = []
    for i in range(0, len(raw), 8):
        secs, mg100 = struct.unpack_from("<II", raw, i)
        out.append((TWIIST_EPOCH + timedelta(seconds=secs), mg100 / 100.0))
    return out


async def fetch_twiist(s: AppSettings, since: datetime) -> list[dict]:
    async with httpx.AsyncClient(timeout=25) as c:
        token = await _twiist_token(c, s)
        h = {"Authorization": f"Bearer {token}", "Accept": "*/*", "User-Agent": TWIIST_UA}
        r = await c.get(f"{TWIIST_API}/pwd/overviews", headers=h)
        if r.status_code == 401:
            _tokens.pop(_key("twiist", s.twiist_username.lower()), None)
            raise RuntimeError("twiist session expired, retrying on the next sync.")
        r.raise_for_status()
        people = [o for o in (r.json() or []) if o.get("pwdId")]
        if not people:
            raise RuntimeError("This twiist account isn't following anyone yet. Invite it as a follower from the twiist app.")
        r = await c.get(f"{TWIIST_API}/pwd/{people[0]['pwdId'].lower()}/package", headers=h)
        r.raise_for_status()
    status = (r.json() or {}).get("status") or {}
    rows = [(ts, v) for ts, v in twiist_glucose((status.get("glucoseHistory") or {}).get("data")) if v > 0]
    rows.sort()
    last_trend = trend((status.get("summary") or {}).get("lastGlucoseTrend"))
    out = [{"ts": ts, "sgv": int(round(v)), "direction": "NONE"} for ts, v in rows]
    if out:
        out[-1]["direction"] = last_trend
    return [o for o in out if o["ts"] > since and 20 <= o["sgv"] <= 600]


# ---------------- Medtronic CareLink ----------------
CL_DISCOVERY = {"EU": "https://clcloud.minimed.eu", "US": "https://clcloud.minimed.com"}
CL_HOST = {"EU": "carelink.minimed.eu", "US": "carelink.minimed.com"}
CL_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
CL_CAPTCHA = "Medtronic asked for a 'not a robot' check. Tap 'Sign in on Medtronic page' to finish signing in."


async def cl_sso(c: httpx.AsyncClient, server: str) -> dict:
    r = await c.get(f"{CL_DISCOVERY[server]}/connect/carepartner/v13/discover/android/3.6")
    r.raise_for_status()
    cps = r.json().get("CP") or []
    entry = next((e for e in cps if (e.get("region") or "").upper() == server), cps[0] if cps else None)
    if not entry or not entry.get("Auth0SSOConfiguration"):
        raise RuntimeError("CareLink sign-in is unavailable right now.")
    r = await c.get(entry["Auth0SSOConfiguration"])
    r.raise_for_status()
    cfg = r.json()
    srv = cfg["server"]
    port = f":{srv['port']}" if srv.get("port") not in (None, 0, 443) else ""
    base = f"https://{srv['hostname']}{port}{srv.get('prefix') or ''}"
    cl = cfg["client"]
    ep = cfg["system_endpoints"]
    return {"base": base, "token_url": base + ep["token_endpoint_path"], "authorize": base + ep["authorization_endpoint_path"],
            "client_id": cl["client_id"], "scope": cl.get("scope", ""), "audience": cl.get("audience", ""),
            "redirect_uri": cl["redirect_uri"]}


def pkce() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def cl_authorize_url(sso: dict, challenge: str, state: str) -> str:
    q = {"client_id": sso["client_id"], "response_type": "code", "scope": sso["scope"], "audience": sso["audience"],
         "redirect_uri": sso["redirect_uri"], "code_challenge": challenge, "code_challenge_method": "S256", "state": state}
    return f"{sso['authorize']}?{urlencode(q)}"


async def cl_exchange(c: httpx.AsyncClient, sso: dict, code: str, verifier: str) -> dict:
    r = await c.post(sso["token_url"], data={"grant_type": "authorization_code", "client_id": sso["client_id"], "code": code,
                                             "redirect_uri": sso["redirect_uri"], "code_verifier": verifier})
    if r.status_code != 200 or "refresh_token" not in r.json():
        raise RuntimeError("CareLink sign-in could not be completed. Please try again.")
    return r.json()


def _code_from(url: str) -> Optional[str]:
    return (parse_qs(urlparse(url).query).get("code") or [None])[0]


async def _cl_password_login(s: AppSettings) -> dict:
    """Headless Auth0 login; Medtronic often answers with a CAPTCHA, then the in-app page is needed."""
    async with httpx.AsyncClient(timeout=25, follow_redirects=False, headers={"User-Agent": CL_UA}) as c:
        sso = await cl_sso(c, s.cl_server)
        verifier, challenge = pkce()
        url = cl_authorize_url(sso, challenge, secrets.token_hex(16))
        html = ""
        for _ in range(10):
            r = await c.get(url)
            if r.is_redirect:
                url = urljoin(url, r.headers["location"])
                continue
            html = r.text
            break
        m = re.search(r'<form[^>]*action="([^"]*)"|<form[^>]*action=\'([^\']*)\'', html, re.I)
        if not m:
            raise RuntimeError(CL_CAPTCHA)
        action = urljoin(url, unescape(m.group(1) or m.group(2)))
        fields = {unescape(n): unescape(v) for n, v in
                  re.findall(r'<input[^>]*type="hidden"[^>]*name="([^"]*)"\s*value="([^"]*)"', html, re.I)}
        fields.update({"username": s.cl_username, "password": s.cl_password, "action": "default"})
        r = await c.post(action, data=fields)
        body = r.text
        if "captcha" in body.lower() or "arkose" in body.lower():
            raise RuntimeError(CL_CAPTCHA)
        if "wrong username or password" in body.lower():
            raise RuntimeError("CareLink login failed: wrong username or password.")
        code = None
        for _ in range(15):
            loc = r.headers.get("location")
            if not loc:
                break
            code = _code_from(loc)
            if code or not loc.startswith("http") and not loc.startswith("/"):
                break
            r = await c.get(urljoin(str(r.url), loc))
        if not code:
            m = re.search(r'["\']([^"\']*[?&]code=[^"\']*)["\']', body)
            code = _code_from(unescape(m.group(1))) if m else None
        if not code:
            raise RuntimeError(CL_CAPTCHA)
        return {**await cl_exchange(c, sso, code, verifier), "token_url": sso["token_url"], "client_id": sso["client_id"]}


async def _cl_token(s: AppSettings, save: Save) -> str:
    key = _key("carelink", s.cl_username.lower() or "token", s.cl_server)
    if (t := _cached(key)):
        return t[0]
    tok = None
    if s.cl_refresh_token:
        async with httpx.AsyncClient(timeout=25, headers={"User-Agent": CL_UA}) as c:
            sso = await cl_sso(c, s.cl_server)
            r = await c.post(sso["token_url"], data={"grant_type": "refresh_token", "client_id": sso["client_id"],
                                                     "refresh_token": s.cl_refresh_token})
        if r.status_code == 200 and r.json().get("access_token"):
            tok = r.json()
        elif r.status_code >= 500:
            raise RuntimeError("CareLink is not answering right now.")
        else:
            await save(cl_refresh_token="")  # rejected: don't keep showing "signed in"
    if tok is None:
        if not s.cl_password:
            await save(cl_refresh_token="")
            raise RuntimeError("CareLink sign-in expired. Tap 'Sign in on Medtronic page' again.")
        tok = await _cl_password_login(s)
    if tok.get("refresh_token") and tok["refresh_token"] != s.cl_refresh_token:
        await save(cl_refresh_token=tok["refresh_token"])
    _tokens[key] = (tok["access_token"], time.time() + min(int(tok.get("expires_in", 3600)), 3600) - 120, None)
    return tok["access_token"]


def _naive(v: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(v[:19])
    except (TypeError, ValueError):
        return None


def carelink_readings(data: dict) -> list[dict]:
    data = data.get("patientData") or data
    sgs = [g for g in data.get("sgs") or [] if g.get("sg") and (g.get("kind") or "SG") == "SG" and g.get("datetime")]
    offset = timedelta(0)
    pump = _naive(data.get("sMedicalDeviceTime") or "")
    server_ms = data.get("currentServerTime") or 0
    if pump and server_ms:
        diff = pump.replace(tzinfo=timezone.utc).timestamp() - server_ms / 1000
        offset = timedelta(hours=round(diff / 3600))
    out = []
    for g in sgs:
        n = _naive(g["datetime"])
        if not n:
            continue
        out.append({"ts": n.replace(tzinfo=timezone.utc) - offset, "sgv": int(g["sg"]), "direction": "NONE"})
    out.sort(key=lambda o: o["ts"])
    if out:
        out[-1]["direction"] = trend(data.get("lastSGTrend"))
    return out


async def fetch_carelink(s: AppSettings, since: datetime, save: Save) -> list[dict]:
    token = await _cl_token(s, save)
    host = f"https://{CL_HOST[s.cl_server]}"
    h = {"Authorization": f"Bearer {token}", "User-Agent": CL_UA, "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=30, headers=h) as c:
        r = await c.get(f"{host}/patient/users/me")
        if r.status_code == 401:
            _tokens.pop(_key("carelink", s.cl_username.lower() or "token", s.cl_server), None)
            raise RuntimeError("CareLink session expired, retrying on the next sync.")
        r.raise_for_status()
        me = r.json()
        username = me.get("username") or s.cl_username
        carepartner = (me.get("role") or "").upper() in ("CARE_PARTNER", "CARE_PARTNER_OUS")
        patient = s.cl_patient or None
        if carepartner and not patient:
            r = await c.get(f"{host}/patient/m2m/links/patients")
            links = r.json() if r.status_code == 200 else []
            if not links:
                raise RuntimeError("This CareLink care partner account has no linked patient yet.")
            if len(links) > 1:
                names = ", ".join(p.get("username", "?") for p in links)
                raise RuntimeError(f"This account follows several people ({names}). Type the one to follow in 'Patient'.")
            patient = links[0]["username"]
        data = None
        r = await c.get(f"{host}/patient/monitor/data")
        if r.status_code == 200 and r.content:
            d = r.json()
            if (d.get("patientData") or d).get("sgs"):
                data = d
        if data is None:
            r = await c.get(f"{host}/patient/countries/settings", params={"countryCode": s.cl_country or "gb", "language": "en"})
            endpoint = r.json().get("blePereodicDataEndpoint") if r.status_code == 200 else None
            if endpoint:
                body = {"username": username, "role": "carepartner" if carepartner else "patient"}
                if patient or (not carepartner and me.get("id")):
                    body["patientId"] = patient or me.get("id")
                r = await c.post(endpoint, json=body)
                if r.status_code == 200 and r.content:
                    data = r.json()
        if data is None and carepartner:
            for v in ("/v6/", "/v5/", "/v11/"):
                r = await c.post(f"{host}/connect/carepartner{v}display/data",
                                 json={"username": username, "role": "carepartner", "patientId": patient})
                if r.status_code == 200 and r.content:
                    data = r.json()
                    break
        if data is None and not carepartner:
            r = await c.get(f"{host}/patient/connect/data",
                            params={"cpSerialNumber": "NONE", "msgType": "last24hours", "requestTime": int(time.time() * 1000)})
            if r.status_code == 200 and r.content:
                data = r.json()
    if data is None:
        raise RuntimeError("Signed in to CareLink, but no glucose came back. Check that the pump is uploading.")
    if s.cl_username != username:
        await save(cl_username=username)
    return [o for o in carelink_readings(data) if o["ts"] > since]


# ---------------- Glooko / Omnipod DISCOVER ----------------
GLOOKO_API = {"US": "api.glooko.com", "EU": "eu.api.glooko.com", "CA": "ca.api.glooko.com", "DE-FR": "de-fr.api.glooko.com"}
GLOOKO_WEB = {"US": "https://my.glooko.com", "EU": "https://eu.my.glooko.com", "CA": "https://ca.my.glooko.com",
              "DE-FR": "https://de-fr.my.glooko.com"}
GLOOKO_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15"
GLOOKO_DEVICE = {"applicationType": "logbook", "os": "android", "osVersion": "33", "device": "Google Pixel 8 Pro",
                 "deviceManufacturer": "Google", "deviceModel": "Pixel 8 Pro", "serialNumber": "HIDDEN",
                 "clinicalResearch": False, "deviceId": "HIDDEN", "applicationVersion": "6.1.3", "buildNumber": "0",
                 "gitHash": "g4fbed2011b"}


def _glooko_headers(region: str, cookie: str = "") -> dict:
    web = GLOOKO_WEB[region]
    h = {"Accept": "application/json, text/plain, */*", "User-Agent": GLOOKO_UA, "Referer": f"{web}/", "Origin": web,
         "Accept-Language": "en-GB,en;q=0.9"}
    if cookie:
        h["Cookie"] = cookie
    return h


async def _glooko_session(c: httpx.AsyncClient, s: AppSettings) -> tuple[str, str]:
    key = _key("glooko", s.glooko_email.lower(), s.glooko_region)
    if (t := _cached(key)):
        return t[0], t[2]
    r = await c.post(f"https://{GLOOKO_API[s.glooko_region]}/api/v2/users/sign_in", headers=_glooko_headers(s.glooko_region),
                     json={"userLogin": {"email": s.glooko_email, "password": s.glooko_password}, "deviceInformation": GLOOKO_DEVICE})
    if r.status_code in (401, 422):
        raise RuntimeError("Glooko login failed. Check email, password and region.")
    r.raise_for_status()
    cookie = next((f"_logbook-web_session={v}" for k, v in r.cookies.items() if k == "_logbook-web_session"), "")
    code = ((r.json() or {}).get("userLogin") or {}).get("glookoCode")
    if not cookie or not code:
        raise RuntimeError("Glooko sign-in needs an extra step (two-factor). Turn it off in Glooko or try again later.")
    _tokens[key] = (cookie, time.time() + 23 * 3600, code)
    return cookie, code


def glooko_readings(items: list[dict], tz: str) -> list[dict]:
    try:
        zone = ZoneInfo(tz)
    except Exception:
        zone = timezone.utc
    out = []
    for g in items:
        if g.get("soft_deleted") or not g.get("display_time") or not g.get("bg_value"):
            continue
        local = _naive(g["display_time"])  # Glooko stores the phone's wall clock with a fake "Z"
        if not local:
            continue
        v = float(g["bg_value"])
        mg = v / 100 if v > 1000 else v
        out.append({"ts": local.replace(tzinfo=zone).astimezone(timezone.utc), "sgv": int(round(mg)), "direction": trend(g.get("trend"))})
    out.sort(key=lambda o: o["ts"])
    return [o for o in out if 20 <= o["sgv"] <= 600]


async def fetch_glooko(s: AppSettings, since: datetime) -> list[dict]:
    start = max(since, datetime.now(timezone.utc) - timedelta(days=14)) - timedelta(hours=14)
    end = datetime.now(timezone.utc) + timedelta(hours=14)
    f = "%Y-%m-%dT%H:%M:%S.000Z"
    async with httpx.AsyncClient(timeout=30) as c:
        cookie, code = await _glooko_session(c, s)
        params = {"patient": code, "startDate": start.strftime(f), "endDate": end.strftime(f),
                  "lastGuid": "1e0c094e-1e54-4a4f-8e6a-f94484b53789", "lastUpdatedAt": start.strftime(f),
                  "limit": max(1, int((end - start).total_seconds() // 300))}
        r = await c.get(f"https://{GLOOKO_API[s.glooko_region]}/api/v2/cgm/readings", params=params,
                        headers=_glooko_headers(s.glooko_region, cookie))
        if r.status_code == 401:
            _tokens.pop(_key("glooko", s.glooko_email.lower(), s.glooko_region), None)
            raise RuntimeError("Glooko session expired, retrying on the next sync.")
        r.raise_for_status()
    return [o for o in glooko_readings(r.json().get("readings") or [], s.tz) if o["ts"] > since]


def reset_cloud_sessions() -> None:
    uid = CURRENT_UID.get(None)
    for k in [k for k in _tokens if k[0] == uid]:
        _tokens.pop(k, None)
