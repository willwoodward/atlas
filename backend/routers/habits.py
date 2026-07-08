from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/habits", tags=["habits"])


class HabitIn(BaseModel):
    id: str
    name: str
    color: str
    created_at: str


class CompletionIn(BaseModel):
    date: str


@router.get("")
async def list_habits(user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT * FROM habits ORDER BY created_at") as cur:
        habits = [dict(r) for r in await cur.fetchall()]
    for h in habits:
        async with db.execute(
            "SELECT date FROM habit_completions WHERE habit_id = ?", (h["id"],)
        ) as cur:
            h["completions"] = [r["date"] for r in await cur.fetchall()]
    return habits


@router.post("")
async def add_habit(body: HabitIn, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "INSERT INTO habits (id, name, color, created_at) VALUES (?, ?, ?, ?)",
        (body.id, body.name, body.color, body.created_at),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/{habit_id}")
async def remove_habit(habit_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM habits WHERE id = ?", (habit_id,))
    await db.execute("DELETE FROM habit_completions WHERE habit_id = ?", (habit_id,))
    await db.commit()
    return {"ok": True}


@router.post("/{habit_id}/toggle")
async def toggle_habit(habit_id: str, body: CompletionIn, user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute(
        "SELECT 1 FROM habit_completions WHERE habit_id = ? AND date = ?", (habit_id, body.date)
    ) as cur:
        exists = await cur.fetchone()
    if exists:
        await db.execute(
            "DELETE FROM habit_completions WHERE habit_id = ? AND date = ?", (habit_id, body.date)
        )
    else:
        await db.execute(
            "INSERT INTO habit_completions (habit_id, date) VALUES (?, ?)", (habit_id, body.date)
        )
    await db.commit()
    return {"ok": True}
