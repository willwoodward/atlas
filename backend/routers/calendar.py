from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from auth import get_current_user
from database import get_db
import calendar_colors

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


class EventIn(BaseModel):
    id: str
    title: str
    date: str
    start_h: float = 9.0
    end_h: float = 10.0
    color: str = "#5f7591"
    notes: str = ""


@router.get("")
async def list_events(user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT * FROM local_events ORDER BY date, start_h") as cur:
        return [dict(r) for r in await cur.fetchall()]


@router.post("")
async def add_event(body: EventIn, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "INSERT INTO local_events (id, title, date, start_h, end_h, color, notes) VALUES (?,?,?,?,?,?,?)",
        (body.id, body.title, body.date, body.start_h, body.end_h, body.color, body.notes),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/{event_id}")
async def remove_event(event_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM local_events WHERE id = ?", (event_id,))
    await db.commit()
    return {"ok": True}


class EventMove(BaseModel):
    date: str | None = None
    start_h: float | None = None
    end_h: float | None = None


@router.patch("/{event_id}")
async def move_event(event_id: str, body: EventMove, user=Depends(get_current_user), db=Depends(get_db)):
    """Reschedule a local event (the calendar's drag-to-move)."""
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if fields:
        sets = ", ".join(f"{k} = ?" for k in fields)
        await db.execute(f"UPDATE local_events SET {sets} WHERE id = ?", (*fields.values(), event_id))
        await db.commit()
    return {"ok": True}


# ── Google Calendar colour rules (see calendar_colors.py) ──────────────────
@router.get("/color-rules")
async def get_color_rules(user=Depends(get_current_user), db=Depends(get_db)):
    return {**await calendar_colors.get_rules(db), "choices": calendar_colors.CHOICES}


@router.put("/color-rules")
async def set_color_rules(body: dict, user=Depends(get_current_user), db=Depends(get_db)):
    try:
        await calendar_colors.set_rules(db, {"rules": body.get("rules"), "fallback": body.get("fallback")})
    except ValueError as e:
        raise HTTPException(422, str(e))
    return {"ok": True}
