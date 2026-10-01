import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/goals", tags=["goals"])


class GoalIn(BaseModel):
    id: str
    title: str
    color: str
    created_at: str
    q1: str = ""
    q2: str = ""
    q3: str = ""
    q4: str = ""


class GoalUpdate(BaseModel):
    title: Optional[str] = None
    color: Optional[str] = None


class QuarterIn(BaseModel):
    text: str


class ReflectionIn(BaseModel):
    text: str


PERIOD_RE = re.compile(r"^\d{4}-Q[1-4]$")


@router.get("")
async def list_goals(user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT * FROM goals ORDER BY created_at") as cur:
        return [dict(r) for r in await cur.fetchall()]


@router.get("/reflections")
async def list_reflections(user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT * FROM goal_reflections ORDER BY period") as cur:
        return [dict(r) for r in await cur.fetchall()]


@router.put("/reflections/{period}")
async def set_reflection(period: str, body: ReflectionIn, user=Depends(get_current_user), db=Depends(get_db)):
    if not PERIOD_RE.match(period):
        raise HTTPException(400, "period must look like 2026-Q3")
    await db.execute(
        """INSERT INTO goal_reflections (period, text, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(period) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at""",
        (period, body.text, datetime.now(timezone.utc).isoformat()),
    )
    await db.commit()
    return {"ok": True}


@router.post("")
async def add_goal(body: GoalIn, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "INSERT INTO goals (id, title, color, created_at, q1, q2, q3, q4) VALUES (?,?,?,?,?,?,?,?)",
        (body.id, body.title, body.color, body.created_at, body.q1, body.q2, body.q3, body.q4),
    )
    await db.commit()
    return {"ok": True}


@router.patch("/{goal_id}")
async def update_goal(goal_id: str, body: GoalUpdate, user=Depends(get_current_user), db=Depends(get_db)):
    if body.title is not None:
        await db.execute("UPDATE goals SET title = ? WHERE id = ?", (body.title, goal_id))
    if body.color is not None:
        await db.execute("UPDATE goals SET color = ? WHERE id = ?", (body.color, goal_id))
    await db.commit()
    return {"ok": True}


@router.patch("/{goal_id}/quarter/{quarter}")
async def set_quarter(goal_id: str, quarter: str, body: QuarterIn, user=Depends(get_current_user), db=Depends(get_db)):
    col = quarter.lower()
    if col not in ("q1", "q2", "q3", "q4"):
        return {"ok": False, "error": "invalid quarter"}
    await db.execute(f"UPDATE goals SET {col} = ? WHERE id = ?", (body.text, goal_id))
    await db.commit()
    return {"ok": True}


@router.delete("/{goal_id}")
async def remove_goal(goal_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    await db.commit()
    return {"ok": True}
