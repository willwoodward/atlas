from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/github-drafts", tags=["github-drafts"])


class DraftIn(BaseModel):
    path: str
    content: str


@router.get("")
async def list_drafts(user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT path, saved_at FROM github_drafts ORDER BY saved_at DESC") as cur:
        return [dict(r) for r in await cur.fetchall()]


@router.put("")
async def upsert_draft(draft: DraftIn, user=Depends(get_current_user), db=Depends(get_db)):
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "INSERT INTO github_drafts (path, content, saved_at) VALUES (?, ?, ?)"
        " ON CONFLICT(path) DO UPDATE SET content=excluded.content, saved_at=excluded.saved_at",
        (draft.path, draft.content, now),
    )
    await db.commit()
    return {"ok": True}


@router.get("/{path:path}")
async def get_draft(path: str, user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute(
        "SELECT path, content, saved_at FROM github_drafts WHERE path=?", (path,)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Draft not found")
    return dict(row)


@router.delete("/{path:path}")
async def delete_draft(path: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM github_drafts WHERE path=?", (path,))
    await db.commit()
    return {"ok": True}
