"""Username + password auth (JWT bearer) and per-user data scoping."""
import os
import re
import secrets
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from bson import ObjectId
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator

from email_service import reset_code_email, send_email

CURRENT_UID: ContextVar[str] = ContextVar("current_uid")
JWT_DAYS = 60  # long-lived so alarms and background sync keep working on the phone
ALGORITHM = "HS256"
DUMMY_HASH = bcrypt.hashpw(b"dummy-password-not-used", bcrypt.gensalt()).decode()
bearer = HTTPBearer(auto_error=False)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=8, max_length=72)


class Credentials(BaseModel):
    """Sign in: any existing username (older accounts may be shorter than today's rules)."""
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=72)


class Registration(BaseModel):
    username: str = Field(max_length=32)
    password: str = Field(min_length=8, max_length=72)
    # shown in emergency texts and calls ("Anna's glucose is ...")
    name: str = Field(default="", max_length=40, validate_default=True)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 3:
            raise ValueError("Name needs at least 3 characters")
        return v

    @field_validator("username")
    @classmethod
    def _valid(cls, v: str) -> str:
        if re.search(r"\s", v):
            raise ValueError("Username can't contain spaces")
        if len(v) < 5:
            raise ValueError("Username needs at least 5 characters")
        if not re.fullmatch(r"[A-Za-z0-9_.]+", v):
            raise ValueError("Username can use letters, numbers, dots and underscores")
        return v


class EmailIn(BaseModel):
    email: str = Field(max_length=254)

    @field_validator("email")
    @classmethod
    def _valid(cls, v: str) -> str:
        v = v.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[a-z]{2,}", v):
            raise ValueError("Enter a valid email address")
        return v


class ForgotIn(BaseModel):
    username: str = Field(min_length=1, max_length=32)


class ResetIn(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=8, max_length=72)


class Scoped:
    """Collection wrapper that always filters/stamps documents with the current user's id."""

    def __init__(self, coll):
        self.c = coll

    def _f(self, f=None):
        return {**(f or {}), "uid": CURRENT_UID.get()}

    def find(self, f=None, *a, **k):
        return self.c.find(self._f(f), *a, **k)

    async def find_one(self, f=None, *a, **k):
        return await self.c.find_one(self._f(f), *a, **k)

    async def insert_one(self, d):
        return await self.c.insert_one({**d, "uid": CURRENT_UID.get()})

    async def insert_many(self, docs, **k):
        return await self.c.insert_many([{**d, "uid": CURRENT_UID.get()} for d in docs], **k)

    async def update_one(self, f, u, **k):
        return await self.c.update_one(self._f(f), u, **k)

    async def update_many(self, f, u, **k):
        return await self.c.update_many(self._f(f), u, **k)

    async def delete_one(self, f):
        return await self.c.delete_one(self._f(f))

    async def delete_many(self, f):
        return await self.c.delete_many(self._f(f))


def setup(db):
    norm = lambda u: u.strip().casefold()  # noqa: E731

    def token(uid: str, username: str) -> str:
        now = datetime.now(timezone.utc)
        return jwt.encode({"sub": uid, "username": username, "iat": now, "exp": now + timedelta(days=JWT_DAYS)},
                          os.environ["JWT_SECRET"], algorithm=ALGORITHM)

    async def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
        unauth = HTTPException(401, "Please sign in again", headers={"WWW-Authenticate": "Bearer"})
        if not creds or creds.scheme.lower() != "bearer":
            raise unauth
        try:
            payload = jwt.decode(creds.credentials, os.environ["JWT_SECRET"], algorithms=[ALGORITHM])
            user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        except (jwt.InvalidTokenError, KeyError, ValueError, TypeError):
            raise unauth
        if not user:
            raise unauth
        CURRENT_UID.set(str(user["_id"]))
        return user

    async def register(body: Registration):
        try:
            res = await db.users.insert_one({
                "username": body.username, "username_normalized": norm(body.username),
                "password_hash": bcrypt.hashpw(body.password.encode(), bcrypt.gensalt(12)).decode(),
                "created_at": datetime.now(timezone.utc)})
        except Exception as exc:
            if "duplicate" in str(exc).lower():
                raise HTTPException(409, "That username is taken")
            raise
        await db.settings.update_one({"_id": str(res.inserted_id)}, {"$set": {"em_name": body.name}}, upsert=True)
        return {"access_token": token(str(res.inserted_id), body.username), "username": body.username}

    async def login(body: Credentials, request: Request):
        key = f"{request.client.host if request.client else 'x'}:{norm(body.username)}"
        now = datetime.now(timezone.utc)
        row = await db.login_attempts.find_one({"_id": key})
        if row and row["failures"] >= 5 and row["expires_at"] > now:
            raise HTTPException(429, "Too many tries. Wait 15 minutes and try again.")
        user = await db.users.find_one({"username_normalized": norm(body.username)})
        ok = bcrypt.checkpw(body.password.encode(), (user["password_hash"] if user else DUMMY_HASH).encode())
        if not user or not ok:
            await db.login_attempts.update_one({"_id": key}, {"$inc": {"failures": 1},
                                                              "$setOnInsert": {"expires_at": now + timedelta(minutes=15)}},
                                               upsert=True)
            raise HTTPException(401, "Wrong username or password")
        await db.login_attempts.delete_one({"_id": key})
        return {"access_token": token(str(user["_id"]), user["username"]), "username": user["username"]}

    async def change_password(body: PasswordChange, user: dict = Depends(current_user)):
        if not bcrypt.checkpw(body.current_password.encode(), user["password_hash"].encode()):
            raise HTTPException(400, "Current password is incorrect")
        if body.current_password == body.new_password:
            raise HTTPException(400, "New password must be different")
        new_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt(12)).decode()
        res = await db.users.update_one({"_id": user["_id"], "password_hash": user["password_hash"]},
                                        {"$set": {"password_hash": new_hash}})
        if res.matched_count != 1:
            raise HTTPException(409, "Password was changed at the same time. Try again.")
        return {"ok": True}

    async def me(user: dict = Depends(current_user)):
        return {"id": str(user["_id"]), "username": user["username"], "email": user.get("email")}

    async def set_email(body: EmailIn, user: dict = Depends(current_user)):
        await db.users.update_one({"_id": user["_id"]}, {"$set": {"email": body.email}})
        return {"username": user["username"], "email": body.email}

    generic = {"ok": True, "message": "If this account has an email, a 6-digit code is on its way."}

    async def forgot(body: ForgotIn):
        user = await db.users.find_one({"username_normalized": norm(body.username)})
        if not user or not user.get("email"):
            return generic  # don't reveal which accounts exist or have an email
        now = datetime.now(timezone.utc)
        row = await db.password_resets.find_one({"_id": user["_id"]})
        if row and row["sent_at"].replace(tzinfo=timezone.utc) > now - timedelta(seconds=60):
            raise HTTPException(429, "A code was just sent. Wait a minute before asking again.")
        code = f"{secrets.randbelow(10**6):06d}"
        await db.password_resets.update_one({"_id": user["_id"]}, {"$set": {
            "code_hash": bcrypt.hashpw(code.encode(), bcrypt.gensalt()).decode(), "sent_at": now,
            "expires_at": now + timedelta(minutes=15), "attempts": 0}}, upsert=True)
        subject, html = reset_code_email(user["username"], code)
        await send_email(to=user["email"], subject=subject, html=html)
        return generic

    async def reset(body: ResetIn):
        bad = HTTPException(400, "That code is wrong or has expired. Ask for a new one.")
        user = await db.users.find_one({"username_normalized": norm(body.username)})
        row = await db.password_resets.find_one({"_id": user["_id"]}) if user else None
        if not row or row["expires_at"].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc) or row["attempts"] >= 5:
            raise bad
        if not bcrypt.checkpw(body.code.encode(), row["code_hash"].encode()):
            await db.password_resets.update_one({"_id": user["_id"]}, {"$inc": {"attempts": 1}})
            raise bad
        await db.users.update_one({"_id": user["_id"]}, {"$set": {
            "password_hash": bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt(12)).decode()}})
        await db.password_resets.delete_one({"_id": user["_id"]})
        await db.login_attempts.delete_many({"_id": {"$regex": f":{re.escape(norm(body.username))}$"}})
        return {"access_token": token(str(user["_id"]), user["username"]), "username": user["username"]}

    return current_user, register, login, change_password, me, set_email, forgot, reset
