"""The inbox API: items (threads from background runs), suggested changes,
routines, and push subscriptions. The logic lives in inbox.py and push.py."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

import inbox
import push
from auth import get_current_user

router = APIRouter(prefix="/inbox", tags=["inbox"])


# ── Routines ── (before /{item_id}, so "routines" isn't read as an item id)

class RoutineIn(BaseModel):
    name: str | None = Field(None, max_length=80)
    prompt: str | None = Field(None, max_length=4000)
    days: list[str] | None = None
    time: str | None = None
    approval: str | None = None
    notify: bool | None = None
    enabled: bool | None = None
    keep_hours: int | None = None   # 0: keep threads; else delete them this long after
    agent_id: str | None = Field(None, max_length=60)   # who does it: "atlas" or one of yours
    trigger: str | None = None          # schedule | bank_import | budget | calendar (triggers.py)
    trigger_config: dict | None = None  # budget: {percent}; calendar: {days}


@router.get("/routines")
async def get_routines(user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        return {"routines": await inbox.list_routines(db)}
    finally:
        await db.close()


@router.post("/routines")
async def post_routine(body: RoutineIn, user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        await inbox.remember_user(db, user)
        return await inbox.create_routine(db, body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    finally:
        await db.close()


@router.put("/routines/{routine_id}")
async def put_routine(routine_id: str, body: RoutineIn, user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        await inbox.remember_user(db, user)
        r = await inbox.update_routine(db, routine_id, body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    finally:
        await db.close()
    if not r:
        raise HTTPException(404, "No such routine")
    return r


@router.delete("/routines/{routine_id}")
async def remove_routine(routine_id: str, user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        if not await inbox.delete_routine(db, routine_id):
            raise HTTPException(404, "No such routine")
        return {"ok": True}
    finally:
        await db.close()


@router.post("/routines/{routine_id}/run")
async def run_routine_now(routine_id: str, test: bool = False, user: dict = Depends(get_current_user)):
    """Run now. ?test=1 for a test run: suggestions only, no notification."""
    db = await inbox.connect()
    try:
        await inbox.remember_user(db, user)
        exists = await inbox.get_routine(db, routine_id)
    finally:
        await db.close()
    if not exists:
        raise HTTPException(404, "No such routine")
    item = await inbox.start_routine(routine_id, "manual", test=test)
    if not item:
        raise HTTPException(409, "It's already running.")
    return item


# ── Notifications ──

class SubscriptionIn(BaseModel):
    endpoint: str = Field(..., max_length=2000)
    keys: dict


@router.get("/push/key")
async def push_key(user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        return {"key": await push.public_key(db)}
    finally:
        await db.close()


@router.post("/push/subscribe")
async def push_subscribe(body: SubscriptionIn, request: Request, user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        await push.subscribe(db, body.model_dump(), request.headers.get("user-agent", ""))
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    finally:
        await db.close()


class EndpointIn(BaseModel):
    endpoint: str = Field(..., max_length=2000)


@router.post("/push/unsubscribe")
async def push_unsubscribe(body: EndpointIn, user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        await push.unsubscribe(db, body.endpoint)
        return {"ok": True}
    finally:
        await db.close()


@router.post("/push/status")
async def push_status(body: EndpointIn, user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        return {"subscribed": await push.is_subscribed(db, body.endpoint)}
    finally:
        await db.close()


@router.post("/push/test")
async def push_test(user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        sent = await push.notify(db, "Atlas", "Notifications are working.", tag="atlas-test")
        return {"sent": sent}
    finally:
        await db.close()


# ── Suggested changes ──

class DecisionIn(BaseModel):
    # Approve with these arguments instead (edited before saying yes).
    args: dict | None = None


async def _decide(proposal_id: str, approve: bool, args: dict | None = None):
    db = await inbox.connect()
    try:
        return await inbox.decide(db, proposal_id, approve, args)
    except inbox.ProposalError as exc:
        raise HTTPException(409, str(exc))
    finally:
        await db.close()


@router.post("/proposals/{proposal_id}/approve")
async def approve(proposal_id: str, body: DecisionIn | None = None, user: dict = Depends(get_current_user)):
    return await _decide(proposal_id, True, body.args if body else None)


@router.post("/proposals/{proposal_id}/reject")
async def reject(proposal_id: str, user: dict = Depends(get_current_user)):
    return await _decide(proposal_id, False)


# ── Items ──

@router.get("")
async def list_items(view: str = "all", user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        return await inbox.list_items(db, view)
    finally:
        await db.close()


@router.get("/counts")
async def item_counts(user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        return await inbox.counts(db)
    finally:
        await db.close()


async def _item_or_404(db, item_id: str) -> dict:
    view = await inbox.item_view(db, item_id)
    if not view:
        raise HTTPException(404, "No such item")
    return view


@router.get("/{item_id}")
async def get_item(item_id: str, user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        return await _item_or_404(db, item_id)
    finally:
        await db.close()


class FlagsIn(BaseModel):
    read: bool | None = None
    archived: bool | None = None


@router.patch("/{item_id}")
async def patch_item(item_id: str, body: FlagsIn, user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        await _item_or_404(db, item_id)
        if body.read is not None:
            await db.execute("UPDATE inbox_items SET read=? WHERE id=?", (int(body.read), item_id))
        if body.archived is not None:
            await db.execute("UPDATE inbox_items SET archived=? WHERE id=?", (int(body.archived), item_id))
        await db.commit()
        return {"ok": True, "counts": await inbox.counts(db)}
    finally:
        await db.close()


@router.delete("/{item_id}")
async def delete_item(item_id: str, user: dict = Depends(get_current_user)):
    """Delete a thread for good (see inbox.delete_item)."""
    db = await inbox.connect()
    try:
        try:
            found = await inbox.delete_item(db, item_id)
        except inbox.BusyError as exc:
            raise HTTPException(409, str(exc))
        if not found:
            raise HTTPException(404, "No such item")
        return {"ok": True, "counts": await inbox.counts(db)}
    finally:
        await db.close()


@router.post("/{item_id}/approve-all")
async def approve_all(item_id: str, user: dict = Depends(get_current_user)):
    db = await inbox.connect()
    try:
        item = await _item_or_404(db, item_id)
        results = [await inbox.decide(db, p["id"], True) for p in item["proposals"] if p["status"] == "pending"]
        return {"results": results}
    finally:
        await db.close()


class ReplyIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=20_000)


@router.post("/{item_id}/reply")
async def reply(item_id: str, body: ReplyIn, request: Request, user: dict = Depends(get_current_user)):
    try:
        out = await inbox.reply(item_id, body.message, request.headers.get("authorization", ""))
    except inbox.BusyError as exc:
        raise HTTPException(409, str(exc))
    if not out:
        raise HTTPException(404, "No such item")
    return out
