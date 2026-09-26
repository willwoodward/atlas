"""
Strava API client.

Three constraints from Strava's terms shape this file, and each is easy to break
by accident, so they are written down here rather than left to be rediscovered:

1. **No retention beyond a transient cache.** Strava's API policy forbids
   keeping Strava data longer than seven days outside a transient cache. So
   activities live only in `_cache` below: process memory, a fifteen-minute
   TTL, gone on restart. Nothing from an activity is written to SQLite. The only
   stored row is the connection (athlete id and tokens), which is a credential
   rather than activity data, and it is encrypted.

2. **No AI use.** The policy forbids using Strava data "in connection with the
   development, training, evaluation, or operation of any AI Application". The
   assistant routes through a third-party model, so no MCP tool may read from
   this module. tests/test_fitness.py asserts that.

3. **Refresh tokens rotate.** Every refresh returns a new refresh token and
   invalidates the old one immediately, so the new one must be persisted before
   anything else happens, or the connection is silently lost at the next
   refresh.

Scope is read-only (`activity:read_all`). No write scope is ever requested, so
this integration cannot create, edit or delete anything on your Strava account.
"""
import os
import secrets
import time
from datetime import datetime, timezone

import httpx

from crypto import dec, enc

STRAVA_CLIENT_ID = os.getenv("STRAVA_CLIENT_ID", "")
STRAVA_CLIENT_SECRET = os.getenv("STRAVA_CLIENT_SECRET", "")

AUTHORIZE_URL = "https://www.strava.com/oauth/authorize"
TOKEN_URL = "https://www.strava.com/oauth/token"
DEAUTH_URL = "https://www.strava.com/oauth/deauthorize"
API = "https://www.strava.com/api/v3"

# read_all adds "Only You" activities and privacy-zone detail; still read-only.
SCOPE = "read,activity:read_all"

CACHE_TTL = 15 * 60
# On a 429, a stale copy beats an error — but never anywhere near the policy's
# seven-day ceiling, and never across a restart.
STALE_MAX_AGE = 6 * 60 * 60

_cache: dict[str, tuple[float, object]] = {}


def _client(**kw) -> httpx.AsyncClient:
    """The one place an HTTP client is made, so tests can substitute a fake
    Strava without patching httpx globally."""
    return httpx.AsyncClient(**kw)
_states: dict[str, dict] = {}


class StravaError(Exception):
    """Base class; the message is safe to show the user."""


class StravaNotConfigured(StravaError):
    pass


class StravaNotConnected(StravaError):
    pass


class StravaAuthRevoked(StravaError):
    """Strava refused our token — usually because access was revoked from the
    Strava side. The stored connection is deleted when this is raised."""


class StravaRateLimited(StravaError):
    pass


def configured() -> bool:
    return bool(STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET)


# ── OAuth ─────────────────────────────────────────────────────────────────────

def new_state(subject: str) -> str:
    """A single-use, short-lived state bound to the signed-in user.

    The redirect comes back through a browser popup with no session attached, so
    the state is the only thing tying the returned code to the person who asked
    for it. Without it, anyone could make this server bind their Strava account
    to your dashboard.
    """
    now = time.time()
    for k in [k for k, v in _states.items() if v["expires"] < now]:
        _states.pop(k, None)
    token = "atlas-strava:" + secrets.token_urlsafe(24)
    _states[token] = {"sub": subject, "expires": now + 600}
    return token


def consume_state(state: str, subject: str) -> bool:
    entry = _states.pop(state or "", None)
    return bool(entry) and entry["expires"] > time.time() and entry["sub"] == subject


def authorize_url(state: str, redirect_uri: str) -> str:
    if not configured():
        raise StravaNotConfigured("Strava isn't configured on the server yet.")
    q = httpx.QueryParams({
        "client_id": STRAVA_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "approval_prompt": "auto",
        "scope": SCOPE,
        "state": state,
    })
    return f"{AUTHORIZE_URL}?{q}"


async def exchange_code(db, code: str, granted_scope: str) -> None:
    if not configured():
        raise StravaNotConfigured("Strava isn't configured on the server yet.")
    # The consent screen lets the user untick activity access. Without it the
    # connection would "succeed" and then show nothing, which looks like a bug.
    if "activity:read" not in (granted_scope or ""):
        raise StravaError("Activity access wasn't granted on the Strava consent screen.")

    async with _client(timeout=15) as client:
        resp = await client.post(TOKEN_URL, data={
            "client_id": STRAVA_CLIENT_ID,
            "client_secret": STRAVA_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
        })
    if resp.status_code != 200:
        raise StravaError("Strava rejected the authorisation code. Try connecting again.")
    body = resp.json()

    await db.execute("DELETE FROM strava_connection")
    await db.execute(
        "INSERT INTO strava_connection (id, athlete_id, access_token, refresh_token, expires_at, scope, connected_at) "
        "VALUES (1, ?, ?, ?, ?, ?, ?)",
        (body["athlete"]["id"], enc(body["access_token"]), enc(body["refresh_token"]),
         int(body["expires_at"]), granted_scope, datetime.now(timezone.utc).isoformat()),
    )
    await db.commit()
    purge_cache()


async def connection(db) -> dict | None:
    async with db.execute("SELECT * FROM strava_connection WHERE id = 1") as cur:
        row = await cur.fetchone()
    return dict(row) if row else None


async def _access_token(db) -> tuple[str, int]:
    conn = await connection(db)
    if not conn:
        raise StravaNotConnected("Strava isn't connected.")

    access = dec(conn["access_token"])
    if access and conn["expires_at"] > time.time() + 60:
        return access, conn["athlete_id"]

    refresh = dec(conn["refresh_token"])
    if not refresh:
        # Encrypted under a key that is no longer configured.
        await disconnect_local(db)
        raise StravaAuthRevoked("Stored Strava credentials couldn't be read. Connect again.")

    async with _client(timeout=15) as client:
        resp = await client.post(TOKEN_URL, data={
            "client_id": STRAVA_CLIENT_ID,
            "client_secret": STRAVA_CLIENT_SECRET,
            "grant_type": "refresh_token",
            "refresh_token": refresh,
        })
    if resp.status_code in (400, 401):
        await disconnect_local(db)
        raise StravaAuthRevoked("Strava access was revoked. Connect again to resume.")
    if resp.status_code == 429:
        raise StravaRateLimited("Strava's rate limit was hit. Try again in a few minutes.")
    if resp.status_code != 200:
        raise StravaError("Couldn't refresh the Strava connection.")

    body = resp.json()
    # Persist first: the old refresh token is already dead.
    await db.execute(
        "UPDATE strava_connection SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = 1",
        (enc(body["access_token"]), enc(body["refresh_token"]), int(body["expires_at"])),
    )
    await db.commit()
    return body["access_token"], conn["athlete_id"]


async def disconnect_local(db) -> None:
    """Forget everything Strava-derived: the connection and the cache."""
    await db.execute("DELETE FROM strava_connection")
    await db.commit()
    purge_cache()


async def disconnect(db) -> None:
    """Revoke at Strava, then forget locally. Revocation is best-effort — the
    local purge must happen even if Strava is unreachable."""
    conn = await connection(db)
    if conn:
        token = dec(conn["access_token"])
        if token:
            try:
                async with _client(timeout=10) as client:
                    await client.post(DEAUTH_URL, data={"access_token": token})
            except httpx.HTTPError:
                pass
    await disconnect_local(db)


# ── Transient cache ───────────────────────────────────────────────────────────

def purge_cache() -> None:
    _cache.clear()


def _cached(key: str, max_age: float):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < max_age:
        return hit[1]
    return None


async def _get(db, path: str, params: dict) -> object:
    token, _ = await _access_token(db)
    async with _client(timeout=20) as client:
        resp = await client.get(f"{API}{path}", params=params,
                                headers={"Authorization": f"Bearer {token}"})
    if resp.status_code == 401:
        await disconnect_local(db)
        raise StravaAuthRevoked("Strava access was revoked. Connect again to resume.")
    if resp.status_code == 429:
        raise StravaRateLimited("Strava's rate limit was hit. Try again in a few minutes.")
    if resp.status_code != 200:
        raise StravaError(f"Strava returned an error ({resp.status_code}).")
    return resp.json()


async def activities_since(db, after_epoch: int) -> tuple[list[dict], bool]:
    """Activities after a timestamp, plus whether the result is stale.

    Paged at Strava's maximum of 200. Twelve weeks is normally one request, which
    matters against a limit of 100 reads per fifteen minutes.
    """
    key = f"activities:{after_epoch // 3600}"
    fresh = _cached(key, CACHE_TTL)
    if fresh is not None:
        return fresh, False

    try:
        out: list[dict] = []
        for page in range(1, 6):
            batch = await _get(db, "/athlete/activities",
                               {"after": after_epoch, "per_page": 200, "page": page})
            out.extend(batch)
            if len(batch) < 200:
                break
    except StravaRateLimited:
        stale = _cached(key, STALE_MAX_AGE)
        if stale is not None:
            return stale, True
        raise

    _cache[key] = (time.time(), out)
    return out, False


async def athlete_stats(db) -> dict | None:
    """Year-to-date and all-time totals, which a twelve-week window can't give.
    Optional: a failure here should not blank the whole page."""
    fresh = _cached("stats", CACHE_TTL)
    if fresh is not None:
        return fresh
    _, athlete_id = await _access_token(db)
    try:
        stats = await _get(db, f"/athletes/{athlete_id}/stats", {})
    except StravaRateLimited:
        return _cached("stats", STALE_MAX_AGE)
    _cache["stats"] = (time.time(), stats)
    return stats
