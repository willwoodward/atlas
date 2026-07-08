from fastapi import APIRouter, Depends
from pydantic import BaseModel
from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/notes", tags=["notes"])


class NoteIn(BaseModel):
    id: str
    body: str = ""
    updated_at: str


class NoteUpdate(BaseModel):
    body: str
    updated_at: str


@router.get("")
async def list_notes(user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT * FROM notes ORDER BY updated_at DESC") as cur:
        return [dict(r) for r in await cur.fetchall()]


@router.post("")
async def add_note(body: NoteIn, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "INSERT INTO notes (id, body, updated_at) VALUES (?, ?, ?)",
        (body.id, body.body, body.updated_at),
    )
    await db.commit()
    return {"ok": True}


@router.patch("/{note_id}")
async def update_note(note_id: str, body: NoteUpdate, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "UPDATE notes SET body = ?, updated_at = ? WHERE id = ?",
        (body.body, body.updated_at, note_id),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/{note_id}")
async def remove_note(note_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    await db.commit()
    return {"ok": True}
