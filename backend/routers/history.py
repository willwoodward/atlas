"""History charts: values over time (history.py)."""
from fastapi import APIRouter, Depends, HTTPException, Query

import history
import inbox
from auth import get_current_user

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("")
async def get_series(keys: str = Query("net_worth", max_length=500), range: str = "90d",
                     user: dict = Depends(get_current_user)):
    """One or more series (comma-separated keys), over 30d, 90d, 1y or all."""
    if range not in history.RANGES:
        raise HTTPException(422, "range is 30d, 90d, 1y or all")
    db = await inbox.connect()
    try:
        out = []
        for key in [k for k in keys.split(",") if k][:12]:
            s = await history.series(db, key, range)
            if s:
                out.append(s)
        return {"series": out, "available": await history.available(db)}
    finally:
        await db.close()


@router.get("/cashflow")
async def get_cashflow(months: int = 12, user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        return await history.cashflow(db, months)
    finally:
        await db.close()


@router.get("/habits")
async def get_habits(weeks: int = 12, user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        return await history.habits(db, weeks)
    finally:
        await db.close()
