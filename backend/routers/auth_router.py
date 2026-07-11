import os
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import create_jwt, get_current_user, verify_google_token
from database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GCAL_TOKEN_URL = "https://oauth2.googleapis.com/token"


class GoogleTokenIn(BaseModel):
    access_token: str


class GcalCodeIn(BaseModel):
    code: str
    redirect_uri: str


@router.post("/google")
async def google_login(body: GoogleTokenIn):
    claims = await verify_google_token(body.access_token)
    email = claims.get("email", "")
    name = claims.get("name", "")
    token = create_jwt(email, name)
    return {"token": token, "email": email, "name": name}


@router.get("/me")
async def me(user=Depends(get_current_user)):
    return user


@router.post("/gcal/exchange")
async def gcal_exchange(body: GcalCodeIn, user=Depends(get_current_user), db=Depends(get_db)):
    """Exchange a Google OAuth authorization code for access + refresh tokens."""
    if not GOOGLE_CLIENT_SECRET:
        raise HTTPException(500, "GOOGLE_CLIENT_SECRET not configured")

    async with httpx.AsyncClient() as client:
        resp = await client.post(GCAL_TOKEN_URL, data={
            "code": body.code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": body.redirect_uri,
            "grant_type": "authorization_code",
        })

    if resp.status_code != 200:
        raise HTTPException(400, f"Google token exchange failed: {resp.text}")

    data = resp.json()
    access_token = data.get("access_token")
    refresh_token = data.get("refresh_token")
    expires_in = data.get("expires_in", 3600)
    expires_at = int(time.time()) + expires_in - 60  # 60s buffer

    await db.execute(
        """INSERT INTO user_integrations (email, gcal_refresh_token, gcal_access_token, gcal_access_expires_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET
             gcal_refresh_token = COALESCE(excluded.gcal_refresh_token, gcal_refresh_token),
             gcal_access_token = excluded.gcal_access_token,
             gcal_access_expires_at = excluded.gcal_access_expires_at""",
        (user["sub"], refresh_token, access_token, expires_at),
    )
    await db.commit()
    return {"ok": True}


@router.get("/gcal/token")
async def gcal_token(user=Depends(get_current_user), db=Depends(get_db)):
    """Return a valid GCal access token, refreshing if needed."""
    async with db.execute(
        "SELECT gcal_refresh_token, gcal_access_token, gcal_access_expires_at FROM user_integrations WHERE email = ?",
        (user["sub"],),
    ) as cur:
        row = await cur.fetchone()

    if not row or not row["gcal_refresh_token"]:
        raise HTTPException(401, "Google Calendar not connected")

    now = int(time.time())
    # Return cached token if it has > 5 minutes left
    if row["gcal_access_token"] and row["gcal_access_expires_at"] and row["gcal_access_expires_at"] > now + 300:
        return {"access_token": row["gcal_access_token"]}

    # Refresh the access token
    if not GOOGLE_CLIENT_SECRET:
        raise HTTPException(500, "GOOGLE_CLIENT_SECRET not configured")

    async with httpx.AsyncClient() as client:
        resp = await client.post(GCAL_TOKEN_URL, data={
            "refresh_token": row["gcal_refresh_token"],
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "grant_type": "refresh_token",
        })

    if resp.status_code != 200:
        raise HTTPException(401, "Failed to refresh GCal token")

    data = resp.json()
    access_token = data["access_token"]
    expires_at = int(time.time()) + data.get("expires_in", 3600) - 60

    await db.execute(
        "UPDATE user_integrations SET gcal_access_token = ?, gcal_access_expires_at = ? WHERE email = ?",
        (access_token, expires_at, user["sub"]),
    )
    await db.commit()
    return {"access_token": access_token}


@router.delete("/gcal")
async def gcal_disconnect(user=Depends(get_current_user), db=Depends(get_db)):
    """Revoke and clear stored GCal tokens."""
    async with db.execute(
        "SELECT gcal_refresh_token FROM user_integrations WHERE email = ?",
        (user["sub"],),
    ) as cur:
        row = await cur.fetchone()

    if row and row["gcal_refresh_token"]:
        # Best-effort revoke
        try:
            async with httpx.AsyncClient() as client:
                await client.post("https://oauth2.googleapis.com/revoke",
                                  params={"token": row["gcal_refresh_token"]})
        except Exception:
            pass

    await db.execute(
        "UPDATE user_integrations SET gcal_refresh_token=NULL, gcal_access_token=NULL, gcal_access_expires_at=NULL WHERE email=?",
        (user["sub"],),
    )
    await db.commit()
    return {"ok": True}
