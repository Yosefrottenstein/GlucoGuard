"""Username + password auth (JWT bearer) and per-user data scoping."""
import os
import re
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from bson import ObjectId
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator

CURRENT_UID: ContextVar[str] = ContextVar("current_uid")
JWT_DAYS = 60  # long-lived so alarms and background sync keep working on the phone
ALGORITHM = "HS256"
DUMMY_HASH = bcrypt.hashpw(b"dummy-password-not-used", bcrypt.gensalt()).decode()
bearer = HTTPBearer(auto_error=False)


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=72)

    @field_validator("username")
    @classmethod
    def _valid(cls, v: str) -> str:
        v = v.strip()
        if not re.fullmatch(r"[A-Za-z0-9_.]+", v):
            raise ValueError("Username can use letters, numbers, dots and underscores")
        return v


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

    async def register(body: Credentials):
        try:
            res = await db.users.insert_one({
                "username": body.username, "username_normalized": norm(body.username),
                "password_hash": bcrypt.hashpw(body.password.encode(), bcrypt.gensalt(12)).decode(),
                "created_at": datetime.now(timezone.utc)})
        except Exception as exc:
            if "duplicate" in str(exc).lower():
                raise HTTPException(409, "That username is taken")
            raise
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

    return current_user, register, login
