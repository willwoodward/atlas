"""
Fitness: a gym log you maintain, and Strava activities read live.

The two halves have different rules. Gym data is yours and is stored like any
other table. Strava data is theirs to license, which means read-only access,
nothing persisted beyond a transient in-memory cache, and nothing handed to an
AI — see strava_client.py for why each of those holds.
"""
import os
import time
import uuid
from datetime import date, timedelta
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import fitness_stats
import strava_client as strava
from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/fitness", tags=["fitness"])


def allowed_origins() -> set[str]:
    """Same source as the CORS config in main.py, read here to avoid importing
    main (which imports this module)."""
    raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:4173")
    return {o.strip().rstrip("/") for o in raw.split(",") if o.strip()}


# ── Gym ───────────────────────────────────────────────────────────────────────

class SectionIn(BaseModel):
    id: str
    name: str
    color: str = "#c15f3c"


class SectionUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class ExerciseIn(BaseModel):
    id: str
    name: str
    weight: Optional[float] = None
    unit: str = "kg"
    sets: Optional[int] = None
    reps: str = ""
    notes: str = ""


class ExerciseUpdate(BaseModel):
    name: Optional[str] = None
    weight: Optional[float] = None
    unit: Optional[str] = None
    sets: Optional[int] = None
    reps: Optional[str] = None
    notes: Optional[str] = None
    section_id: Optional[str] = None


HISTORY_PER_EXERCISE = 12


async def _log(db, exercise_id: str, weight, sets, reps):
    """Record the working weight for today.

    One row per exercise per day: nudging a number up and down while standing at
    the rack is one change, not six, and the progression line should say so.
    """
    today = date.today().isoformat()
    async with db.execute(
        "SELECT id FROM gym_lift_log WHERE exercise_id = ? AND date = ?", (exercise_id, today)
    ) as cur:
        row = await cur.fetchone()
    if row:
        await db.execute("UPDATE gym_lift_log SET weight = ?, sets = ?, reps = ? WHERE id = ?",
                         (weight, sets, reps or "", row["id"]))
    else:
        await db.execute(
            "INSERT INTO gym_lift_log (id, exercise_id, date, weight, sets, reps) VALUES (?,?,?,?,?,?)",
            (str(uuid.uuid4()), exercise_id, today, weight, sets, reps or ""),
        )


@router.get("/gym")
async def get_gym(user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT * FROM gym_sections ORDER BY sort_order") as cur:
        sections = [dict(r) for r in await cur.fetchall()]
    async with db.execute("SELECT * FROM gym_exercises ORDER BY sort_order") as cur:
        exercises = [dict(r) for r in await cur.fetchall()]
    async with db.execute("SELECT * FROM gym_lift_log ORDER BY date") as cur:
        logs = [dict(r) for r in await cur.fetchall()]

    by_ex: dict[str, list] = {}
    for entry in logs:
        by_ex.setdefault(entry["exercise_id"], []).append(entry)

    for ex in exercises:
        history = by_ex.get(ex["id"], [])[-HISTORY_PER_EXERCISE:]
        ex["history"] = [{"date": h["date"], "weight": h["weight"], "sets": h["sets"], "reps": h["reps"]}
                         for h in history]
    for s in sections:
        s["exercises"] = [e for e in exercises if e["section_id"] == s["id"]]
    return {"sections": sections}


@router.post("/gym/sections")
async def add_section(body: SectionIn, user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM gym_sections") as cur:
        order = (await cur.fetchone())[0]
    await db.execute("INSERT INTO gym_sections (id, name, color, sort_order) VALUES (?,?,?,?)",
                     (body.id, body.name.strip(), body.color, order))
    await db.commit()
    return {"ok": True}


@router.patch("/gym/sections/{section_id}")
async def update_section(section_id: str, body: SectionUpdate,
                         user=Depends(get_current_user), db=Depends(get_db)):
    fields = body.model_dump(exclude_none=True)
    if fields:
        sets = ", ".join(f"{k} = ?" for k in fields)
        await db.execute(f"UPDATE gym_sections SET {sets} WHERE id = ?", (*fields.values(), section_id))
        await db.commit()
    return {"ok": True}


@router.delete("/gym/sections/{section_id}")
async def remove_section(section_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    # SQLite does not enforce the FK cascade without PRAGMA foreign_keys, so the
    # children are removed explicitly rather than left as orphans.
    await db.execute(
        "DELETE FROM gym_lift_log WHERE exercise_id IN (SELECT id FROM gym_exercises WHERE section_id = ?)",
        (section_id,))
    await db.execute("DELETE FROM gym_exercises WHERE section_id = ?", (section_id,))
    await db.execute("DELETE FROM gym_sections WHERE id = ?", (section_id,))
    await db.commit()
    return {"ok": True}


@router.post("/gym/sections/{section_id}/exercises")
async def add_exercise(section_id: str, body: ExerciseIn,
                       user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT 1 FROM gym_sections WHERE id = ?", (section_id,)) as cur:
        if not await cur.fetchone():
            raise HTTPException(404, "No such section")
    async with db.execute(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM gym_exercises WHERE section_id = ?", (section_id,)
    ) as cur:
        order = (await cur.fetchone())[0]
    await db.execute(
        "INSERT INTO gym_exercises (id, section_id, name, weight, unit, sets, reps, notes, sort_order, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (body.id, section_id, body.name.strip(), body.weight, body.unit, body.sets, body.reps,
         body.notes, order, date.today().isoformat()),
    )
    if body.weight is not None:
        await _log(db, body.id, body.weight, body.sets, body.reps)
    await db.commit()
    return {"ok": True}


@router.patch("/gym/exercises/{exercise_id}")
async def update_exercise(exercise_id: str, body: ExerciseUpdate,
                          user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT * FROM gym_exercises WHERE id = ?", (exercise_id,)) as cur:
        current = await cur.fetchone()
    if not current:
        raise HTTPException(404, "No such exercise")
    current = dict(current)

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {"ok": True}
    fields["updated_at"] = date.today().isoformat()
    sets = ", ".join(f"{k} = ?" for k in fields)
    await db.execute(f"UPDATE gym_exercises SET {sets} WHERE id = ?", (*fields.values(), exercise_id))

    # Only a change to the working set is progression; renaming is not.
    after = {**current, **fields}
    if any(k in fields and fields[k] != current[k] for k in ("weight", "sets", "reps")) \
            and after["weight"] is not None:
        await _log(db, exercise_id, after["weight"], after["sets"], after["reps"])
    await db.commit()
    return {"ok": True}


@router.delete("/gym/exercises/{exercise_id}")
async def remove_exercise(exercise_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM gym_lift_log WHERE exercise_id = ?", (exercise_id,))
    await db.execute("DELETE FROM gym_exercises WHERE id = ?", (exercise_id,))
    await db.commit()
    return {"ok": True}


# ── Strava ────────────────────────────────────────────────────────────────────

class AuthorizeIn(BaseModel):
    redirect_uri: str


class ExchangeIn(BaseModel):
    code: str
    state: str
    scope: str = ""


def _strava_error(exc: strava.StravaError) -> JSONResponse:
    code, status = {
        strava.StravaNotConfigured: ("not_configured", 409),
        strava.StravaNotConnected: ("not_connected", 409),
        strava.StravaAuthRevoked: ("revoked", 409),
        strava.StravaRateLimited: ("rate_limited", 503),
    }.get(type(exc), ("error", 502))
    return JSONResponse({"detail": str(exc), "code": code}, status_code=status)


@router.get("/strava/status")
async def strava_status(user=Depends(get_current_user), db=Depends(get_db)):
    conn = await strava.connection(db)
    return {
        "configured": strava.configured(),
        "connected": bool(conn),
        "scope": conn["scope"] if conn else None,
        "connected_at": conn["connected_at"] if conn else None,
    }


@router.post("/strava/authorize")
async def strava_authorize(body: AuthorizeIn, user=Depends(get_current_user)):
    # Only send Strava's redirect back to an origin this API already trusts.
    origin = "{0.scheme}://{0.netloc}".format(urlparse(body.redirect_uri))
    if origin not in allowed_origins():
        raise HTTPException(400, "redirect_uri is not an allowed origin")
    try:
        return {"url": strava.authorize_url(strava.new_state(user["sub"]), body.redirect_uri)}
    except strava.StravaError as exc:
        return _strava_error(exc)


@router.post("/strava/exchange")
async def strava_exchange(body: ExchangeIn, user=Depends(get_current_user), db=Depends(get_db)):
    if not strava.consume_state(body.state, user["sub"]):
        raise HTTPException(400, "This Strava sign-in link has expired or was not started here.")
    try:
        await strava.exchange_code(db, body.code, body.scope)
    except strava.StravaError as exc:
        return _strava_error(exc)
    return {"ok": True}


@router.delete("/strava")
async def strava_disconnect(user=Depends(get_current_user), db=Depends(get_db)):
    await strava.disconnect(db)
    return {"ok": True}


@router.get("/strava/summary")
async def strava_summary(weeks: int = Query(12, ge=4, le=26),
                         user=Depends(get_current_user), db=Depends(get_db)):
    """Weekly volume, headline stats and recent activities — computed per
    request from a live fetch, and never written anywhere."""
    today = date.today()
    first_week = fitness_stats.week_start(today) - timedelta(weeks=weeks - 1)
    after = int(time.mktime(first_week.timetuple())) - 86400   # a day's slack for timezones

    try:
        activities, stale = await strava.activities_since(db, after)
    except strava.StravaError as exc:
        return _strava_error(exc)

    try:
        stats = await strava.athlete_stats(db)
    except strava.StravaError:
        stats = None

    rows = fitness_stats.weekly(activities, weeks=weeks, today=today)

    def totals(prefix):
        if not stats:
            return None
        return {sport: stats.get(f"{prefix}_{sport}_totals") for sport in fitness_stats.SPORTS}

    return {
        "weeks": rows,
        "summary": fitness_stats.summarise(rows, activities),
        "recent": fitness_stats.recent(activities),
        "ytd": totals("ytd"),
        "all_time": totals("all"),
        "stale": stale,
    }
