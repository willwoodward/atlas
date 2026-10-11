import os
import secrets
import time
from datetime import datetime, timedelta, timezone

import aiosqlite

import httpx
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from jose import JWTError, jwt

ALLOWED_EMAILS = {e.strip().lower() for e in os.getenv("ALLOWED_EMAILS", "").split(",") if e.strip()}
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30
ATLAS_MCP_KEY = os.getenv("ATLAS_MCP_KEY", "")

# Audience separates the two kinds of token this server mints. They are signed
# with the same secret, so without an audience claim a token issued for MCP is
# indistinguishable from a token issued for a logged-in human — which is exactly
# how an MCP token used to reach every /api/* route.
AUD_APP = "atlas-app"
AUD_MCP = "atlas-mcp"

bearer = HTTPBearer(auto_error=False)

# ── Fail closed ───────────────────────────────────────────────────────────────
# Each of these, if missing, used to quietly open the door: a placeholder
# JWT_SECRET lets anyone forge a session, an empty ALLOWED_EMAILS lets any
# Google account in, and no GOOGLE_CLIENT_ID skips the check that a Google
# token was issued to Atlas. The server refuses to start without them (see
# main.py), and the checks below refuse requests too, so a missed setting is
# an outage, never a breach.

def _weak_secret(secret: str) -> bool:
    s = (secret or "").strip()
    return len(s) < 32 or s == "change-me-in-production" or s.startswith(("replace_with", "your_"))


def config_problems() -> list[str]:
    problems = []
    if _weak_secret(JWT_SECRET):
        problems.append("JWT_SECRET must be a random value of at least 32 characters (e.g. `openssl rand -hex 32`)")
    if not ALLOWED_EMAILS:
        problems.append("ALLOWED_EMAILS must list the Google account(s) allowed to sign in")
    if not GOOGLE_CLIENT_ID:
        problems.append("GOOGLE_CLIENT_ID must be set so sign-in tokens can be checked as issued for Atlas")
    return problems


def _require_allow_list(email: str) -> None:
    if not ALLOWED_EMAILS or email not in ALLOWED_EMAILS:
        raise HTTPException(status_code=403, detail="Not authorised")


async def verify_google_token(access_token: str) -> dict:
    """Verify a Google access token and return its claims.

    The audience check matters: /userinfo happily accepts an access token minted
    for *any* Google OAuth client, so without it, a token this app never issued —
    one collected by an unrelated (or hostile) application the user signed into —
    would authenticate here.
    """
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Sign-in is not configured on the server (GOOGLE_CLIENT_ID)")
    async with httpx.AsyncClient() as client:
        info = await client.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"access_token": access_token},
        )
        if info.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid Google token")
        if info.json().get("aud") != GOOGLE_CLIENT_ID:
            raise HTTPException(status_code=401, detail="Token was not issued for this application")

        resp = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google token")
    claims = resp.json()
    email = claims.get("email", "").lower()
    if not claims.get("email_verified", True):
        raise HTTPException(status_code=403, detail="Email not verified")
    if not ALLOWED_EMAILS or email not in ALLOWED_EMAILS:
        raise HTTPException(status_code=403, detail="Email not authorised")
    return claims


def create_jwt(email: str, name: str) -> str:
    if _weak_secret(JWT_SECRET):
        raise HTTPException(status_code=503, detail="Sign-in is not configured on the server (JWT_SECRET)")
    now = datetime.now(timezone.utc)
    return jwt.encode(
        # jti lets one session be signed out; iat lets "sign out everywhere"
        # cut off every token issued before a moment.
        {"sub": email, "name": name, "aud": AUD_APP, "exp": now + timedelta(days=JWT_EXPIRE_DAYS),
         "iat": int(now.timestamp()), "jti": secrets.token_hex(16)},
        JWT_SECRET, algorithm=JWT_ALGORITHM,
    )


# ── Signing out ───────────────────────────────────────────────────────────────
# A JWT is valid until it expires (30 days) unless the server remembers to
# refuse it. Revocations live in the database and are mirrored in memory, so
# checking a request costs no query. Single API process, so the mirror is the
# whole truth once loaded.

_revoked: set[str] | None = None
_valid_after = 0


async def _db():
    from database import DATABASE_PATH  # late import: database imports nothing from here
    return aiosqlite.connect(DATABASE_PATH)


async def _load_revocations() -> None:
    global _revoked, _valid_after
    if _revoked is not None:
        return
    async with await _db() as db:
        async with db.execute("SELECT jti FROM revoked_tokens WHERE expires_at > ?", (int(time.time()),)) as cur:
            revoked = {r[0] for r in await cur.fetchall()}
        async with db.execute("SELECT value FROM app_settings WHERE key = 'sessions_valid_after'") as cur:
            row = await cur.fetchone()
    _revoked, _valid_after = revoked, int(row[0]) if row else 0


def reset_revocation_cache() -> None:
    """For tests, which recreate the database between cases."""
    global _revoked, _valid_after
    _revoked, _valid_after = None, 0


async def revoke(claims: dict) -> None:
    """Sign out one session. Tokens from before jti existed can't be singled
    out; sign out everywhere covers those."""
    jti = claims.get("jti")
    if not jti:
        return
    await _load_revocations()
    _revoked.add(jti)
    async with await _db() as db:
        await db.execute("DELETE FROM revoked_tokens WHERE expires_at <= ?", (int(time.time()),))
        await db.execute("INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)",
                         (jti, int(claims.get("exp") or time.time() + JWT_EXPIRE_DAYS * 86400)))
        await db.commit()


async def revoke_all(caller: dict | None = None) -> None:
    """Sign out everywhere: every app token issued before now stops working,
    including ones issued before tokens carried an iat (treated as 0). iat is
    whole seconds, so the caller's own token (possibly issued this very
    second) is also revoked by id."""
    global _valid_after
    if caller:
        await revoke(caller)
    await _load_revocations()
    _valid_after = int(time.time())
    async with await _db() as db:
        await db.execute("INSERT INTO app_settings (key, value) VALUES ('sessions_valid_after', ?) "
                         "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (str(_valid_after),))
        await db.commit()


def decode_jwt(token: str, audience: str | None = None) -> dict:
    """Verify signature and expiry. Audience is checked by the caller so the
    failure can say which kind of token was expected."""
    try:
        claims = jwt.decode(
            token, JWT_SECRET, algorithms=[JWT_ALGORITHM],
            options={"verify_aud": False},
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if audience is not None and claims.get("aud") != audience:
        raise HTTPException(status_code=401, detail="Token is not valid for this endpoint")
    return claims


async def get_current_user(credentials: HTTPAuthorizationCredentials = Security(bearer)) -> dict:
    """Two independent gates, on purpose.

    The audience claim stops a token minted for MCP from being replayed against
    the REST API, and the allow-list stops any token whose subject is not the
    owner — so a new token-minting path added later cannot silently inherit
    full access the way the MCP OAuth flow once did.
    """
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    claims = decode_jwt(credentials.credentials, audience=AUD_APP)
    email = (claims.get("sub") or "").lower()
    _require_allow_list(email)
    await _load_revocations()
    if claims.get("jti") in _revoked or int(claims.get("iat") or 0) < _valid_after:
        raise HTTPException(status_code=401, detail="Signed out — please sign in again")
    return claims


async def require_mcp_key(credentials: HTTPAuthorizationCredentials = Security(bearer)):
    if not credentials or credentials.credentials != ATLAS_MCP_KEY:
        raise HTTPException(status_code=401, detail="Invalid MCP key")
