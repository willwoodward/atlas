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

Runs belong to sessions — conversations held on the server, so the laptop and
the phone show the same thread. The browser sends only its new message; the
history comes from the session's earlier runs. A session goes stale after
SESSION_IDLE_MINUTES without activity and the next message starts a new one.
Old sessions are kept, as the session log.
"""
import asyncio
import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import aiosqlite
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import agent_actions
import assistant_memory as memory
from auth import get_current_user
from database import DATABASE_PATH

AGENT_URL = os.getenv("AGENT_URL", "http://agent:8100")
POLL_SECONDS = 0.2          # how often a subscriber checks for new events
IDLE_TIMEOUT_SECONDS = 900  # give up on a run the agent never finishes
# A run blocked on ask_user is idle by design — it is waiting on a human, who may
# be asleep. It is exempt from the stall timeout and gets a much longer ceiling,
# so a forgotten question cannot pin an agent and a sandbox forever.
AWAITING_TIMEOUT_SECONDS = 86_400
# A conversation this quiet is over; the next message starts a fresh one.
SESSION_IDLE_MINUTES = int(os.getenv("ASSISTANT_SESSION_MINUTES", "30"))
# How many earlier turns are replayed to the agent. Its own limit is 60 messages.
MAX_HISTORY_TURNS = 25
LIVE = ("running", "awaiting_input")

router = APIRouter(prefix="/assistant", tags=["assistant"])

# run_id -> asyncio.Task, so cancel() can actually interrupt the HTTP stream.
_tasks: dict[str, asyncio.Task] = {}


class Message(BaseModel):
    role: str
    content: str


class RunRequest(BaseModel):
    # The new message. History comes from the session, not the browser.
    message: str | None = Field(None, min_length=1, max_length=20_000)
    # The conversation it continues. None, closed or gone stale: a new one starts.
    session_id: str | None = None
    # Older clients send the whole thread instead. Still accepted, sessionless.
    messages: list[Message] | None = Field(None, min_length=1, max_length=60)


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


async def _finish(db, run_id: str, status: str, error: str | None = None,
                  reply: str | None = None) -> None:
    now = _now()
    await db.execute(
        "UPDATE agent_runs SET status=?, error=?, updated_at=?, reply=COALESCE(?, reply) WHERE id=?",
        (status, error, now, reply, run_id),
    )
    # The session's clock runs from the end of its last turn, not the start —
    # a ten-minute research run should not eat into the idle window.
    await db.execute(
        "UPDATE agent_sessions SET updated_at=? WHERE id=(SELECT session_id FROM agent_runs WHERE id=?)",
        (now, run_id),
    )
    await db.commit()


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value)


async def _live_session(db, session_id: str | None) -> dict | None:
    """The session if it can still be continued: open, and either busy or recently used."""
    if not session_id:
        return None
    async with db.execute("SELECT * FROM agent_sessions WHERE id=?", (session_id,)) as c:
        row = await c.fetchone()
    if not row or row["closed"]:
        return None
    async with db.execute(
        "SELECT 1 FROM agent_runs WHERE session_id=? AND status IN ('running','awaiting_input') LIMIT 1",
        (session_id,),
    ) as c:
        busy = await c.fetchone() is not None
    idle = datetime.now(timezone.utc) - _parse_time(row["updated_at"])
    if busy or idle < timedelta(minutes=SESSION_IDLE_MINUTES):
        return dict(row)
    return None


async def _current_session_id(db) -> str | None:
    async with db.execute(
        "SELECT id FROM agent_sessions WHERE closed=0 ORDER BY updated_at DESC LIMIT 1"
    ) as c:
        row = await c.fetchone()
    if not row:
        return None
    live = await _live_session(db, row["id"])
    return live["id"] if live else None


async def _session_view(db, session_id: str) -> dict:
    """A session as the browser draws it: its turns as user/assistant messages."""
    async with db.execute("SELECT * FROM agent_sessions WHERE id=?", (session_id,)) as c:
        session = dict(await c.fetchone())
    async with db.execute(
        "SELECT id, status, error, user_message, prompt, reply FROM agent_runs "
        "WHERE session_id=? ORDER BY created_at", (session_id,),
    ) as c:
        runs = [dict(r) for r in await c.fetchall()]
    messages, active = [], None
    for r in runs:
        messages.append({"role": "user", "content": r["user_message"] or r["prompt"], "runId": r["id"]})
        messages.append({"role": "assistant", "content": r["reply"] or "", "runId": r["id"],
                         "status": r["status"], "error": r["error"]})
        if r["status"] in LIVE:
            active = {"id": r["id"], "status": r["status"]}
    expires = _parse_time(session["updated_at"]) + timedelta(minutes=SESSION_IDLE_MINUTES)
    return {
        "session": {**session, "closed": bool(session["closed"]), "expires_at": expires.isoformat()},
        "messages": messages,
        "active_run": active,
    }


async def _drive_run(run_id: str, body: bytes, auth: str) -> None:
    """Stream the agent's SSE into the database. Runs detached from any request."""
    db = await _connect()
    seq = 0
    status, error = "done", None
    cancelled = False
    reply: list[str] = []   # the text of the answer, kept so the session can replay it
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
                        elif kind == "token":
                            reply.append(ev.get("text") or "")
                        seq += 1
                        await _append(db, run_id, seq, kind, json.dumps(ev))
    except asyncio.CancelledError:
        cancelled = True
        # Shielded so the status write survives the cancellation itself.
        await asyncio.shield(_finish(db, run_id, "cancelled", reply="".join(reply)))
        raise
    except Exception as exc:
        status, error = "error", str(exc) or "The assistant hit an error."
        seq += 1
        await _append(db, run_id, seq, "error", json.dumps({"type": "error", "message": error}))
    finally:
        if not cancelled:
            await _finish(db, run_id, status, error, reply="".join(reply))
        await db.close()
        _tasks.pop(run_id, None)


@router.post("/runs")
async def start_run(req: RunRequest, request: Request, user: dict = Depends(get_current_user)):
    """Create a run and return immediately — the work continues in the background.

    With `message`, the run joins the given session if it is still live, or
    starts a new one; the agent is sent that session's earlier turns plus the
    new message. The reply says which session it landed in, and whether that is
    a new one, so a device showing a stale thread knows to clear it.
    """
    if req.message is None and not req.messages:
        raise HTTPException(422, "Send a message.")
    run_id = str(uuid.uuid4())
    now = _now()

    db = await _connect()
    try:
        session_id, new_session = None, False
        if req.message is not None:
            prompt = req.message
            # No session named means this device hasn't synced yet, not "start
            # afresh" ("New chat" closes the old one first). Join the live one,
            # so two devices never end up in parallel conversations.
            live = await _live_session(db, req.session_id or await _current_session_id(db))
            if live:
                session_id = live["id"]
                async with db.execute(
                    "SELECT 1 FROM agent_runs WHERE session_id=? AND status IN ('running','awaiting_input')",
                    (session_id,),
                ) as c:
                    if await c.fetchone():
                        # Two devices answering at once would interleave two
                        # replies into one thread.
                        raise HTTPException(409, "The assistant is still working on the last message.")
            else:
                session_id, new_session = str(uuid.uuid4()), True
                # Snapshot the memory and prompt now. Every turn of this session
                # uses these versions, so the system prompt stays identical (and
                # cacheable) for the whole conversation; edits made during it,
                # by anyone, apply from the next session.
                mem_v = (await memory.current(db, "memory"))["version"] or 0
                prompt_v = (await memory.current(db, "prompt"))["version"] or 0
                await db.execute(
                    "INSERT INTO agent_sessions (id, created_at, updated_at, title, memory_version, prompt_version) "
                    "VALUES (?,?,?,?,?,?)",
                    (session_id, now, now, " ".join(prompt.split())[:80], mem_v, prompt_v),
                )
            history = await _history(db, session_id)
            messages = [*history, {"role": "user", "content": prompt}]
        else:
            prompt = next((m.content for m in reversed(req.messages) if m.role == "user"), "")
            messages = [m.model_dump() for m in req.messages]

        await db.execute(
            "INSERT INTO agent_runs (id, created_at, updated_at, status, prompt, user_message, session_id) "
            "VALUES (?,?,?, 'running', ?, ?, ?)",
            (run_id, now, now, prompt[:500], prompt, session_id),
        )
        if session_id:
            await db.execute("UPDATE agent_sessions SET updated_at=? WHERE id=?", (now, session_id))
        await db.commit()
        if session_id:
            async with db.execute(
                "SELECT memory_version, prompt_version FROM agent_sessions WHERE id=?", (session_id,)
            ) as c:
                snap = await c.fetchone()
            # Sessions from before snapshots existed have NULLs: they get the
            # current versions, as they always did.
            mem_text = (await memory.content_at(db, "memory", snap["memory_version"])
                        if snap["memory_version"] is not None else (await memory.current(db, "memory"))["content"])
            prompt_text = (await memory.content_at(db, "prompt", snap["prompt_version"])
                           if snap["prompt_version"] is not None else (await memory.current(db, "prompt"))["content"])
        else:
            mem_text = (await memory.current(db, "memory"))["content"]
            prompt_text = (await memory.current(db, "prompt"))["content"]
    finally:
        await db.close()

    # run_id goes to the agent so ask_user has an address to be answered at.
    body = json.dumps({
        "messages": messages,
        "run_id": run_id,
        # The session's snapshot of its standing context.
        "memory": mem_text,
        "system_prompt": prompt_text,
    }).encode()
    # Forward the caller's own JWT — the agent re-validates it against
    # ALLOWED_EMAILS, and that second check is only meaningful if it's the real one.
    auth = request.headers.get("authorization", "")
    _tasks[run_id] = asyncio.create_task(_drive_run(run_id, body, auth))
    return {"run_id": run_id, "status": "running", "session_id": session_id, "new_session": new_session}


async def _history(db, session_id: str) -> list[dict]:
    """The session's earlier turns as plain messages, oldest first.

    A turn that ended without any text (cancelled early, failed) contributes
    only the user's message, so the agent still knows it was asked.
    """
    async with db.execute(
        "SELECT user_message, prompt, reply FROM agent_runs WHERE session_id=? "
        "ORDER BY created_at DESC LIMIT ?", (session_id, MAX_HISTORY_TURNS),
    ) as c:
        rows = list(reversed(await c.fetchall()))
    out = []
    for r in rows:
        out.append({"role": "user", "content": r["user_message"] or r["prompt"]})
        if r["reply"]:
            out.append({"role": "assistant", "content": r["reply"]})
    return out


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
    """Stop a run and record it as cancelled before returning.

    task.cancel() only *requests* cancellation — the CancelledError is raised the
    next time the task reaches an await, so the driver's own status write lands
    some time after this endpoint has already answered. Writing here as well
    makes the returned status true at the moment it is returned, and means a run
    still ends up cancelled even if the task never gets to unwind.

    The write is guarded on a live status so cancelling a run that already
    finished reports what actually happened instead of rewriting its history.
    """
    task = _tasks.get(run_id)
    if task and not task.done():
        task.cancel()

    db = await _connect()
    await db.execute(
        "UPDATE agent_runs SET status='cancelled', updated_at=? "
        "WHERE id=? AND status IN ('running','awaiting_input')",
        (_now(), run_id),
    )
    await db.commit()
    async with db.execute("SELECT status FROM agent_runs WHERE id=?", (run_id,)) as c:
        row = await c.fetchone()
    await db.close()
    if not row:
        raise HTTPException(404, "No such run")
    return {"ok": True, "status": row["status"]}


# ── Sessions ─────────────────────────────────────────────────────────────────

@router.get("/sessions/current")
async def current_session(user: dict = Depends(get_current_user)):
    """The conversation every device should be showing, or none if it has gone stale.

    Polled by the browser, so this is how a message sent from the phone appears
    on the laptop.
    """
    db = await _connect()
    try:
        session_id = await _current_session_id(db)
        if not session_id:
            return {"session": None, "messages": [], "active_run": None}
        return await _session_view(db, session_id)
    finally:
        await db.close()


@router.get("/sessions")
async def list_sessions(limit: int = 20, user: dict = Depends(get_current_user)):
    """Past conversations, newest first — the session log."""
    db = await _connect()
    try:
        async with db.execute(
            "SELECT s.id, s.created_at, s.updated_at, s.title, s.closed, COUNT(r.id) AS turns "
            "FROM agent_sessions s LEFT JOIN agent_runs r ON r.session_id = s.id "
            "GROUP BY s.id ORDER BY s.updated_at DESC LIMIT ?", (min(max(limit, 1), 200),),
        ) as c:
            rows = [{**dict(r), "closed": bool(r["closed"])} for r in await c.fetchall()]
        return {"sessions": rows}
    finally:
        await db.close()


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, user: dict = Depends(get_current_user)):
    db = await _connect()
    try:
        async with db.execute("SELECT 1 FROM agent_sessions WHERE id=?", (session_id,)) as c:
            if not await c.fetchone():
                raise HTTPException(404, "No such session")
        return await _session_view(db, session_id)
    finally:
        await db.close()


@router.post("/sessions/{session_id}/close")
async def close_session(session_id: str, user: dict = Depends(get_current_user)):
    """End a conversation ("New chat"). It stays in the log; every device moves on."""
    db = await _connect()
    try:
        cur = await db.execute("UPDATE agent_sessions SET closed=1 WHERE id=?", (session_id,))
        await db.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "No such session")
        return {"ok": True}
    finally:
        await db.close()


# ── Memory and system prompt ─────────────────────────────────────────────────
# Same shape for both: GET the current text, PUT a new version, list the
# history, restore an old version (0 = the default). Changes apply from the next
# session — each session keeps the versions it started with.

class DocIn(BaseModel):
    content: str = Field(..., max_length=memory.MAX_CHARS)


class RestoreIn(BaseModel):
    version: int = Field(..., ge=0)


def _document_routes(kind: str) -> None:
    async def get_doc(user: dict = Depends(get_current_user)):
        db = await _connect()
        try:
            return {**await memory.current(db, kind), "max_chars": memory.MAX_CHARS,
                    "default": memory.DEFAULTS[kind]}
        finally:
            await db.close()

    async def put_doc(body: DocIn, user: dict = Depends(get_current_user)):
        db = await _connect()
        try:
            return await memory.save(db, body.content, "user", kind)
        except memory.MemoryEditError as exc:
            raise HTTPException(422, str(exc))
        finally:
            await db.close()

    async def doc_history(limit: int = 30, user: dict = Depends(get_current_user)):
        db = await _connect()
        try:
            return {"versions": await memory.history(db, min(max(limit, 1), 200), kind)}
        finally:
            await db.close()

    async def restore_doc(body: RestoreIn, user: dict = Depends(get_current_user)):
        """Undo: make an earlier version current again (0 = the default)."""
        db = await _connect()
        try:
            return await memory.restore(db, body.version, kind)
        except memory.MemoryEditError as exc:
            raise HTTPException(404, str(exc))
        finally:
            await db.close()

    router.add_api_route(f"/{kind}", get_doc, methods=["GET"])
    router.add_api_route(f"/{kind}", put_doc, methods=["PUT"])
    router.add_api_route(f"/{kind}/history", doc_history, methods=["GET"])
    router.add_api_route(f"/{kind}/restore", restore_doc, methods=["POST"])


for _kind in memory.KINDS:
    _document_routes(_kind)


# ── Action log ───────────────────────────────────────────────────────────────

@router.get("/actions")
async def list_actions(limit: int = 30, user: dict = Depends(get_current_user)):
    """The assistant's recent changes, newest first, with whether each can still be undone."""
    db = await _connect()
    try:
        return {"actions": await agent_actions.recent(db, min(max(limit, 1), 200))}
    finally:
        await db.close()


@router.post("/actions/{action_id}/undo")
async def undo_action(action_id: str, user: dict = Depends(get_current_user)):
    db = await _connect()
    try:
        return await agent_actions.undo(db, action_id)
    except agent_actions.UndoError as exc:
        raise HTTPException(409, str(exc))
    finally:
        await db.close()


# ── Voice ────────────────────────────────────────────────────────────────────
# The browser records, this forwards the audio to OpenAI's speech-to-text and
# returns the text. Nothing is stored. The audio comes as the raw request body
# (Content-Type audio/webm, audio/mp4 …) rather than a form upload, which keeps
# a multipart parser out of the API.

# A dated snapshot on purpose: the plain "gpt-4o-mini-transcribe" alias is
# scheduled for shutdown on 2027-02-26, and this snapshot has no date set.
# gpt-transcribe is the newer family if this one is ever retired.
TRANSCRIBE_MODEL = os.getenv("TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe-2025-12-15")
MAX_AUDIO_BYTES = 10 * 1024 * 1024   # ~10 min of browser audio; OpenAI's own limit is 25 MB
_AUDIO_EXT = {"webm": "webm", "mp4": "mp4", "mpeg": "mp3", "mp3": "mp3", "ogg": "ogg",
              "wav": "wav", "x-wav": "wav", "m4a": "m4a", "x-m4a": "m4a", "aac": "m4a"}


@router.post("/transcribe")
async def transcribe(request: Request, user: dict = Depends(get_current_user)):
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise HTTPException(503, "Voice input needs OPENAI_API_KEY on the server.")
    ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if not ctype.startswith("audio/"):
        raise HTTPException(415, "Send the recording as audio.")
    ext = _AUDIO_EXT.get(ctype.split("/", 1)[1])
    if not ext:
        raise HTTPException(415, f"Unsupported audio type {ctype}.")

    audio = bytearray()
    async for chunk in request.stream():
        audio += chunk
        if len(audio) > MAX_AUDIO_BYTES:
            raise HTTPException(413, "That recording is too long.")
    if len(audio) < 1000:
        return {"text": ""}  # a tap, not speech

    base = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            resp = await client.post(
                f"{base}/audio/transcriptions",
                headers={"Authorization": f"Bearer {key}"},
                data={"model": TRANSCRIBE_MODEL, "response_format": "json"},
                files={"file": (f"recording.{ext}", bytes(audio), ctype)},
            )
    except httpx.HTTPError:
        raise HTTPException(502, "Couldn't reach the speech-to-text service.")
    if resp.status_code >= 400:
        raise HTTPException(502, f"Speech-to-text failed ({resp.status_code}): {resp.text[:200]}")
    return {"text": (resp.json().get("text") or "").strip()}


@router.get("/health")
async def health(user: dict = Depends(get_current_user)):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{AGENT_URL}/health")
        return resp.json()
    except httpx.HTTPError:
        return {"status": "unreachable"}
