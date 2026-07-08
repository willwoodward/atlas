from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional

from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/integrations", tags=["integrations"])


class GcalUpdate(BaseModel):
    token: str
    expires_at: int


class GitHubUpdate(BaseModel):
    token: str
    repo: str


@router.get("")
async def get_integrations(user: dict = Depends(get_current_user), db=Depends(get_db)):
    async with db.execute(
        "SELECT gcal_token, gcal_expires_at, github_token, github_repo FROM user_integrations WHERE email = ?",
        (user["sub"],),
    ) as cur:
        row = await cur.fetchone()

    if not row:
        return {"gcal": None, "github": None}

    gcal = (
        {"token": row["gcal_token"], "expires_at": row["gcal_expires_at"]}
        if row["gcal_token"]
        else None
    )
    github = (
        {"token": row["github_token"], "repo": row["github_repo"]}
        if row["github_token"]
        else None
    )
    return {"gcal": gcal, "github": github}


@router.put("/gcal")
async def update_gcal(body: GcalUpdate, user: dict = Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        """INSERT INTO user_integrations (email, gcal_token, gcal_expires_at)
           VALUES (?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET gcal_token=excluded.gcal_token, gcal_expires_at=excluded.gcal_expires_at""",
        (user["sub"], body.token, body.expires_at),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/gcal")
async def delete_gcal(user: dict = Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "UPDATE user_integrations SET gcal_token=NULL, gcal_expires_at=NULL WHERE email=?",
        (user["sub"],),
    )
    await db.commit()
    return {"ok": True}


@router.put("/github")
async def update_github(body: GitHubUpdate, user: dict = Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        """INSERT INTO user_integrations (email, github_token, github_repo)
           VALUES (?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET github_token=excluded.github_token, github_repo=excluded.github_repo""",
        (user["sub"], body.token, body.repo),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/github")
async def delete_github(user: dict = Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "UPDATE user_integrations SET github_token=NULL, github_repo=NULL WHERE email=?",
        (user["sub"],),
    )
    await db.commit()
    return {"ok": True}
