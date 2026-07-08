from fastapi import APIRouter, Depends
from pydantic import BaseModel
from auth import get_current_user
from database import get_db

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
