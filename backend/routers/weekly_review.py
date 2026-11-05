"""The weekly review: a week's recap, the model's commentary on it, and which weeks are done."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import weekly_review
from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/weekly-review", tags=["weekly-review"])


def _monday(week: str):
    try:
        return weekly_review.parse_week(week)
    except ValueError:
        raise HTTPException(422, "A week is the date of its Monday, e.g. 2026-11-02")


@router.get("/completed")
async def completed(user=Depends(get_current_user), db=Depends(get_db)):
    """Weeks whose review was finished, newest first."""
    return {"weeks": await weekly_review.completed_weeks(db)}


@router.get("/{week}")
async def get_recap(week: str, currency: str = "EUR", user=Depends(get_current_user), db=Depends(get_db)):
    _monday(week)
    return await weekly_review.recap(db, week, currency)


class NarrateIn(BaseModel):
    currency: str = "EUR"
    refresh: bool = False
    # Hours the calendar shows against each goal, which only the app can see.
    goal_hours: list[dict] = Field(default_factory=list, max_length=30)


@router.post("/{week}/narrate")
async def narrate(week: str, body: NarrateIn, user=Depends(get_current_user), db=Depends(get_db)):
    _monday(week)
    data = await weekly_review.recap(db, week, body.currency)
    hours = [{"goal": str(h.get("goal", ""))[:80], "hours": round(float(h.get("hours") or 0), 1)} for h in body.goal_hours]
    return await weekly_review.narrate(db, data, hours, body.refresh)


@router.put("/{week}/complete")
async def mark_complete(week: str, user=Depends(get_current_user), db=Depends(get_db)):
    _monday(week)
    await weekly_review.set_completed(db, week, True)
    return {"ok": True}


@router.delete("/{week}/complete")
async def unmark_complete(week: str, user=Depends(get_current_user), db=Depends(get_db)):
    _monday(week)
    await weekly_review.set_completed(db, week, False)
    return {"ok": True}
