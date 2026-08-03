"""
Assistant runs — the durable layer in front of the Strands agent container.

The agent has full read/write access to every MCP tool, so it is kept off the
public network entirely: no published ports, reachable only as `agent:8100`
inside the Docker network. This router is the single door in, behind the same
get_current_user JWT dependency as the rest of the API.

Runs are durable on purpose. A research or planning turn can take minutes, and
the browser will not stay open for it. Starting a run spawns a background task
that keeps streaming and persisting events regardless of whether anyone is
listening; subscribers replay the stored events and then follow live, so you can
close your phone mid-run and pick it up from another device.
"""
import asyncio
import json
import os
import uuid
from datetime import datetime, timezone

import aiosqlite
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import get_current_user
from database import DATABASE_PATH

AGENT_URL = os.getenv("AGENT_URL", "http://agent:8100")
POLL_SECONDS = 0.2          # how often a subscriber checks for new events
IDLE_TIMEOUT_SECONDS = 900  # give up on a run the agent never finishes
# A run blocked on ask_user is idle by design — it is waiting on a human, who may
# be asleep. It is exempt from the stall timeout and gets a much longer ceiling,
# so a forgotten question cannot pin an agent and a sandbox forever.
AWAITING_TIMEOUT_SECONDS = 86_400

router = APIRouter(prefix="/assistant", tags=["assistant"])

# run_id -> asyncio.Task, so cancel() can actually interrupt the HTTP stream.
_tasks: dict[str, asyncio.Task] = {}


class Message(BaseModel):
    role: str
    content: str


class RunRequest(BaseModel):
    messages: list[Message] = Field(..., min_length=1, max_length=60)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _connect() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DATABASE_PATH)
    db.row_factory = aiosqlite.Row
    return db


async def _append(db, run_id: str, seq: int, type_: str, payload: str) -> None:
    await db.execute(
        "INSERT OR IGNORE INTO agent_run_events (run_id, seq, type, payload) VALUES (?,?,?,?)",
        (run_id, seq, type_, payload),
    )
    await db.execute("UPDATE agent_runs SET updated_at=? WHERE id=?", (_now(), run_id))
    await db.commit()


async def _set_status(db, run_id: str, status: str) -> None:
    """Move a live run between running and awaiting_input. Not a terminal write."""
    await db.execute(
        "UPDATE agent_runs SET status=?, updated_at=? WHERE id=? AND status IN ('running','awaiting_input')",
        (status, _now(), run_id),
    )
    await db.commit()


async def _finish(db, run_id: str, status: str, error: str | None = None) -> None:
    await db.execute(
        "UPDATE agent_runs SET status=?, error=?, updated_at=? WHERE id=?",
        (status, error, _now(), run_id),
    )
    await db.commit()


async def _drive_run(run_id: str, body: bytes, auth: str) -> None:
    """Stream the agent's SSE into the database. Runs detached from any request."""
    db = await _connect()
    seq = 0
    status, error = "done", None
    cancelled = False
    try:
        timeout = httpx.Timeout(10.0, read=None)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST", f"{AGENT_URL}/chat",
                content=body,
                headers={"Authorization": auth, "Content-Type": "application/json"},
            ) as resp:
                if resp.status_code != 200:
                    detail = (await resp.aread()).decode(errors="replace")[:200]
                    raise RuntimeError(f"Assistant unavailable ({resp.status_code}): {detail}")

                buffer = ""
                async for chunk in resp.aiter_text():
                    buffer += chunk
                    frames = buffer.split("\n\n")
                    buffer = frames.pop()
                    for frame in frames:
                        line = next((l for l in frame.split("\n") if l.startswith("data: ")), None)
                        if not line:
                            continue
                        try:
                            ev = json.loads(line[6:])
                        except json.JSONDecodeError:
                            continue
                        kind = ev.get("type")
                        if kind == "done":
                            continue  # emitted by the subscriber on terminal status
                        # The agent is parked on a question: mark the run so the
                        # subscriber stops counting it as stalled.
                        if kind == "question":
                            await _set_status(db, run_id, "awaiting_input")
                        elif kind in ("question_answered", "question_timeout"):
                            await _set_status(db, run_id, "running")
                        if kind == "error":
                            error = ev.get("message") or "The assistant hit an error."
                            status = "error"
                        seq += 1
                        await _append(db, run_id, seq, kind, json.dumps(ev))
    except asyncio.CancelledError:
        cancelled = True
        # Shielded so the status write survives the cancellation itself.
        await asyncio.shield(_finish(db, run_id, "cancelled"))
        raise
    except Exception as exc:
        status, error = "error", str(exc) or "The assistant hit an error."
        seq += 1
        await _append(db, run_id, seq, "error", json.dumps({"type": "error", "message": error}))
    finally:
        if not cancelled:
            await _finish(db, run_id, status, error)
        await db.close()
        _tasks.pop(run_id, None)


@router.post("/runs")
async def start_run(req: RunRequest, request: Request, user: dict = Depends(get_current_user)):
    """Create a run and return immediately — the work continues in the background."""
    run_id = str(uuid.uuid4())
    prompt = next((m.content for m in reversed(req.messages) if m.role == "user"), "")

    db = await _connect()
    await db.execute(
        "INSERT INTO agent_runs (id, created_at, updated_at, status, prompt) VALUES (?,?,?, 'running', ?)",
        (run_id, _now(), _now(), prompt[:500]),
    )
    await db.commit()
    await db.close()

    # run_id goes to the agent so ask_user has an address to be answered at.
    body = json.dumps({
        "messages": [m.model_dump() for m in req.messages],
        "run_id": run_id,
    }).encode()
    # Forward the caller's own JWT — the agent re-validates it against
    # ALLOWED_EMAILS, and that second check is only meaningful if it's the real one.
    auth = request.headers.get("authorization", "")
    _tasks[run_id] = asyncio.create_task(_drive_run(run_id, body, auth))
    return {"run_id": run_id, "status": "running"}


@router.get("/runs/{run_id}/events")
async def run_events(run_id: str, after: int = 0, user: dict = Depends(get_current_user)):
    """SSE: replay stored events after `seq`, then follow the run live."""
    db = await _connect()
    async with db.execute("SELECT id FROM agent_runs WHERE id=?", (run_id,)) as c:
        if not await c.fetchone():
            await db.close()
            raise HTTPException(404, "No such run")

    async def stream():
        last = after
        idle = 0.0
        try:
            while True:
                async with db.execute(
                    "SELECT seq, payload FROM agent_run_events WHERE run_id=? AND seq>? ORDER BY seq",
                    (run_id, last),
                ) as cur:
                    rows = await cur.fetchall()
                for row in rows:
                    last = row["seq"]
                    yield f"data: {json.dumps({'seq': last, **json.loads(row['payload'])})}\n\n"

                async with db.execute("SELECT status, error FROM agent_runs WHERE id=?", (run_id,)) as cur:
                    run = await cur.fetchone()
                if run and run["status"] not in ("running", "awaiting_input"):
                    yield f"data: {json.dumps({'type': 'done', 'status': run['status'], 'seq': last})}\n\n"
                    return

                waiting = bool(run and run["status"] == "awaiting_input")
                idle = 0.0 if rows else idle + POLL_SECONDS
                limit = AWAITING_TIMEOUT_SECONDS if waiting else IDLE_TIMEOUT_SECONDS
                if idle > limit:
                    yield f"data: {json.dumps({'type': 'done', 'status': 'stalled', 'seq': last})}\n\n"
                    return
                # Comment frame doubles as a keep-alive through Caddy.
                if not rows:
                    yield ": keep-alive\n\n"
                await asyncio.sleep(POLL_SECONDS)
        finally:
            await db.close()

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/runs/{run_id}/history")
async def run_history(run_id: str, user: dict = Depends(get_current_user)):
    """Every event from a finished run, as plain JSON.

    The browser drops tool arguments, results and research summaries before
    writing a thread to localStorage — they run to several KB each. This is how
    that detail is recovered after a reload.
    """
    db = await _connect()
    async with db.execute("SELECT status, error FROM agent_runs WHERE id=?", (run_id,)) as c:
        run = await c.fetchone()
    if not run:
        await db.close()
        raise HTTPException(404, "No such run")
    async with db.execute(
        "SELECT seq, payload FROM agent_run_events WHERE run_id=? ORDER BY seq", (run_id,)
    ) as c:
        events = [{"seq": r["seq"], **json.loads(r["payload"])} for r in await c.fetchall()]
    await db.close()
    return {"run_id": run_id, "status": run["status"], "error": run["error"], "events": events}


class AnswerRequest(BaseModel):
    question_id: str
    answer: str = Field(..., min_length=1, max_length=4000)


@router.post("/runs/{run_id}/answer")
async def answer_run(run_id: str, req: AnswerRequest, request: Request,
                     user: dict = Depends(get_current_user)):
    """Answer a question a running agent is blocked on.

    The agent holds the pending question in memory and is parked on a future, so
    this has to reach the same process — it is forwarded rather than persisted.
    The run then continues with its context and sandbox intact.
    """
    db = await _connect()
    async with db.execute("SELECT status FROM agent_runs WHERE id=?", (run_id,)) as c:
        run = await c.fetchone()
    await db.close()
    if not run:
        raise HTTPException(404, "No such run")
    if run["status"] not in ("running", "awaiting_input"):
        raise HTTPException(409, f"Run is {run['status']} — it can no longer be answered.")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{AGENT_URL}/runs/{run_id}/answer",
                json={"question_id": req.question_id, "answer": req.answer},
                headers={"Authorization": request.headers.get("authorization", "")},
            )
        delivered = resp.status_code == 200 and resp.json().get("delivered")
    except httpx.HTTPError:
        raise HTTPException(503, "The assistant is not reachable.")

    if not delivered:
        # Nothing was waiting: the question timed out, was already answered, or
        # the run restarted. Say so rather than pretending it landed.
        raise HTTPException(409, "That question is no longer waiting for an answer.")
    return {"ok": True}


@router.get("/runs")
async def list_runs(limit: int = 10, user: dict = Depends(get_current_user)):
    db = await _connect()
    async with db.execute(
        "SELECT id, created_at, updated_at, status, prompt, error FROM agent_runs "
        "ORDER BY created_at DESC LIMIT ?", (limit,),
    ) as c:
        rows = [dict(r) for r in await c.fetchall()]
    await db.close()
    return {"runs": rows}


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str, user: dict = Depends(get_current_user)):
    task = _tasks.get(run_id)
    if task and not task.done():
        task.cancel()
    else:
        db = await _connect()
        await _finish(db, run_id, "cancelled")
        await db.close()
    return {"ok": True, "status": "cancelled"}


@router.get("/health")
async def health(user: dict = Depends(get_current_user)):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{AGENT_URL}/health")
        return resp.json()
    except httpx.HTTPError:
        return {"status": "unreachable"}
