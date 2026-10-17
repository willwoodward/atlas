"""
The inbox: Atlas working in the background.

A *routine* is a standing instruction with a schedule ("weekdays at 7:30:
plan my day"). When one is due, the scheduler starts an agent run in a session
of its own, and the run leaves an *inbox item*: the thread, which you can read
later and reply in like a chat.

Nobody is watching a background run, so by default it doesn't change anything
itself. With the routine's approval set to "ask", every tool that would write
(add a to-do, move an event…) is recorded as a *proposal* instead, and the item
waits for a yes. Approving runs the tool for real — logged with an undo, like
any change Atlas makes. "auto" routines act directly; their changes are still
logged and undoable.

How a write becomes a proposal: the agent opens its MCP connection with
X-Atlas-Run and X-Atlas-Approval headers (agent/runtime.py), mcp_server puts
them in a context variable for the connection, and run_tool hands writing
tools to propose() below rather than running them.
"""
import asyncio
import contextvars
import json
import logging
import os
import re
import uuid
from datetime import date, datetime, time as dtime, timedelta, timezone
from zoneinfo import ZoneInfo

import aiosqlite

from database import DATABASE_PATH

log = logging.getLogger("atlas.inbox")

TZ = ZoneInfo(os.getenv("TZ", "Europe/London"))
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
# A routine that missed its slot (the server was down) still runs when it comes
# back — unless it's this late, when it would just be noise.
LATE_LIMIT = timedelta(hours=2)
TICK_SECONDS = 30

# Tools that change something. In an "ask" run these become proposals.
# The assistant's own memory and prompt are left out: they're its notes, not
# the user's data, and every version is kept anyway.
WRITE_TOOLS = {
    "add_todo", "complete_todo", "move_todo", "delete_todo", "set_week_outcomes",
    "log_habit", "create_note", "update_note", "append_to_note", "delete_note",
    "write_github_note", "create_github_folder",
    "create_event", "update_event", "delete_event",
    "set_transaction_category", "rename_category", "add_category_rule", "set_budget",
    "create_habit", "update_goal", "add_subtask",
    "create_routine", "update_routine", "delete_routine",
}

# The run a tool call belongs to, and whether it must ask first. Set per MCP
# connection (mcp_server.handle_sse); None for everything else.
RUN_CONTEXT: contextvars.ContextVar = contextvars.ContextVar("atlas_run_context", default=None)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def connect() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DATABASE_PATH)
    db.row_factory = aiosqlite.Row
    return db


# ── Schedules ────────────────────────────────────────────────────────────────

def parse_days(days: str) -> list[str]:
    picked = [d.strip().lower()[:3] for d in (days or "").split(",")]
    return [d for d in DAYS if d in picked]


def parse_time(value: str) -> dtime:
    m = re.fullmatch(r"\s*(\d{1,2}):(\d{2})\s*", value or "")
    if not m or int(m[1]) > 23 or int(m[2]) > 59:
        raise ValueError("Time must be HH:MM, e.g. 07:30.")
    return dtime(int(m[1]), int(m[2]))


def next_run(days: str, at: str, after: datetime) -> datetime | None:
    """The first scheduled moment strictly after `after`, in UTC. Local time,
    so 07:30 stays 07:30 across the clocks changing."""
    picked = parse_days(days)
    if not picked:
        return None
    t = parse_time(at)
    local = after.astimezone(TZ)
    for offset in range(8):
        day: date = local.date() + timedelta(days=offset)
        if DAYS[day.weekday()] not in picked:
            continue
        candidate = datetime.combine(day, t, tzinfo=TZ)
        if candidate > local:
            return candidate.astimezone(timezone.utc)
    return None


def describe_schedule(days: str, at: str) -> str:
    picked = parse_days(days)
    if len(picked) == 7:
        when = "Every day"
    elif picked == DAYS[:5]:
        when = "Weekdays"
    elif picked == DAYS[5:]:
        when = "Weekends"
    else:
        when = ", ".join(d.capitalize() for d in picked) or "Never"
    return f"{when} at {at}"


# ── Proposals ────────────────────────────────────────────────────────────────

BUCKETS = {"today": "today", "week": "this week", "someday": "someday"}


def _hm(h) -> str:
    try:
        h = float(h)
    except (TypeError, ValueError):
        return ""
    return f"{int(h)}:{round((h - int(h)) * 60):02d}"


async def _todo_text(db, todo_id) -> str:
    async with db.execute("SELECT text FROM todos WHERE id=?", (todo_id,)) as c:
        row = await c.fetchone()
    return row["text"] if row else "a to-do"


async def _note_title(db, note_id) -> str:
    async with db.execute("SELECT body FROM notes WHERE id=?", (note_id,)) as c:
        row = await c.fetchone()
    first = (row["body"] if row else "").strip().split("\n")[0].lstrip("# ").strip()
    return first[:60] or "a note"


async def describe(db, tool: str, a: dict) -> str:
    """A proposal in words, for the approve / reject buttons."""
    q = lambda s: f"“{s}”"
    if tool == "add_todo":
        return f"Add to-do {q(a.get('text', ''))} to {BUCKETS.get(a.get('bucket'), 'today')}"
    if tool == "complete_todo":
        return f"Tick off {q(await _todo_text(db, a.get('id')))}"
    if tool == "move_todo":
        return f"Move {q(await _todo_text(db, a.get('id')))} to {BUCKETS.get(a.get('bucket'), a.get('bucket'))}"
    if tool == "delete_todo":
        return f"Delete to-do {q(await _todo_text(db, a.get('id')))}"
    if tool == "add_subtask":
        return f"Add sub-task {q(a.get('text', ''))}"
    if tool == "set_week_outcomes":
        return "Rewrite this week's outcomes"
    if tool == "create_event":
        when = "all day" if a.get("all_day") or a.get("start") is None else f"{_hm(a.get('start'))}–{_hm(a.get('end'))}"
        return f"Add {q(a.get('title', 'an event'))} on {a.get('date', '?')}, {when}"
    if tool == "update_event":
        changes = [k for k in ("title", "date", "start", "end", "location", "description", "color") if k in a]
        return f"Change an event ({', '.join(changes) or 'details'})" + (f" to {q(a['title'])}" if a.get("title") else "")
    if tool == "delete_event":
        return "Delete a calendar event"
    if tool == "create_note":
        return f"Create a note {q((a.get('body') or '').strip().split(chr(10))[0][:60])}"
    if tool in ("update_note", "append_to_note"):
        return f"{'Edit' if tool == 'update_note' else 'Add to'} the note {q(await _note_title(db, a.get('id')))}"
    if tool == "delete_note":
        return f"Delete the note {q(await _note_title(db, a.get('id')))}"
    if tool == "log_habit":
        return f"Log a habit{' for ' + a['date'] if a.get('date') else ''}"
    if tool == "create_habit":
        return f"Create the habit {q(a.get('name', ''))}"
    if tool == "set_transaction_category":
        n = len(a.get("ids") or [])
        return f"Categorise {n} transaction{'s' if n != 1 else ''} as {q(a.get('category', ''))}"
    if tool == "rename_category":
        return f"Rename category {q(a.get('old', a.get('from', '')))} to {q(a.get('new', a.get('to', '')))}"
    if tool == "add_category_rule":
        return f"Always file {q(a.get('match', a.get('merchant', '')))} under {q(a.get('category', ''))}"
    if tool == "set_budget":
        return f"Set a budget{' for ' + q(a['name']) if a.get('name') else ''}"
    if tool == "update_goal":
        return "Update a goal"
    if tool == "create_routine":
        return f"Create the routine {q(a.get('name', ''))} ({describe_schedule(a.get('days', ','.join(DAYS)), a.get('time', '08:00'))})"
    if tool in ("update_routine", "delete_routine"):
        return f"{'Change' if tool == 'update_routine' else 'Delete'} a routine"
    if tool in ("write_github_note", "create_github_folder"):
        return f"Draft {q(a.get('path', ''))} in your GitHub notes"
    return tool.replace("_", " ").capitalize()


async def propose(db, tool: str, args: dict, ctx: dict) -> dict:
    """Record a change for approval instead of making it. What the agent hears back."""
    async with db.execute("SELECT session_id FROM agent_runs WHERE id=?", (ctx.get("run_id"),)) as c:
        row = await c.fetchone()
    if not row or not row["session_id"]:
        return {"error": "Can't make changes from here, and can't queue them for approval either."}
    pid = uuid.uuid4().hex[:12]
    summary = await describe(db, tool, args)
    await db.execute(
        "INSERT INTO inbox_proposals (id, session_id, run_id, created_at, tool, args, summary) VALUES (?,?,?,?,?,?,?)",
        (pid, row["session_id"], ctx.get("run_id"), _now(), tool, json.dumps(args), summary),
    )
    await db.commit()
    return {
        "proposed": True, "proposal_id": pid, "summary": summary,
        "note": "Not done yet: this is waiting for the user's approval in their inbox. "
                "Carry on as if it will happen, and list it in your summary as a suggestion.",
    }


class ProposalError(Exception):
    pass


async def decide(db, proposal_id: str, approve: bool, args: dict | None = None) -> dict:
    """Approve (optionally with edited arguments) or reject a proposal."""
    async with db.execute("SELECT * FROM inbox_proposals WHERE id=?", (proposal_id,)) as c:
        p = await c.fetchone()
    if not p:
        raise ProposalError("No such suggestion.")
    if p["status"] != "pending":
        raise ProposalError(f"Already {p['status']}.")
    now = _now()
    if not approve:
        await db.execute("UPDATE inbox_proposals SET status='rejected', decided_at=? WHERE id=?", (now, proposal_id))
        await db.commit()
        return {"id": proposal_id, "status": "rejected"}

    import mcp_server   # lazy: mcp_server imports this module
    final = {**json.loads(p["args"]), **(args or {})}
    try:
        result = await mcp_server.run_tool(p["tool"], final, db)
    except Exception as exc:  # a tool raising is a failed approval, not a 500
        log.exception("Approved %s failed", p["tool"])
        result = {"error": str(exc) or "That didn't work."}
    failed = isinstance(result, dict) and bool(result.get("error"))
    summary = await describe(db, p["tool"], final) if args else p["summary"]
    await db.execute(
        "UPDATE inbox_proposals SET status=?, decided_at=?, args=?, summary=?, result=?, undo_id=? WHERE id=?",
        ("failed" if failed else "approved", now, json.dumps(final), summary,
         json.dumps(result, default=str)[:4000], (result or {}).get("undo_id") if isinstance(result, dict) else None,
         proposal_id),
    )
    await db.commit()
    return {"id": proposal_id, "status": "failed" if failed else "approved", "result": result}


# ── Items ────────────────────────────────────────────────────────────────────

def preview_of(markdown: str) -> str:
    text = re.sub(r"```.*?```", " ", markdown or "", flags=re.S)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    # A heading leads into what follows ("Today: A light day…").
    text = re.sub(r"^\s*#{1,6}\s+(.+?)\s*$", lambda m: m[1] if m[1][-1] in ".:!?" else m[1] + ":", text, flags=re.M)
    text = re.sub(r"^\s*([-*+]|\d+[.)]|>)\s+", "", text, flags=re.M)
    text = re.sub(r"[*_`~]", "", text)
    return " ".join(text.split())[:200]


def service_auth(name: str = "") -> str:
    """A short-lived app token for runs nobody started from a browser. The
    agent checks it like any other: signed, for the app, an allowed email."""
    from jose import jwt
    import auth
    import secrets
    email = sorted(auth.ALLOWED_EMAILS)[0] if auth.ALLOWED_EMAILS else ""
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {"sub": email, "name": name, "aud": auth.AUD_APP,
         "exp": now + timedelta(hours=2), "iat": int(now.timestamp()), "jti": secrets.token_hex(16)},
        auth.JWT_SECRET, algorithm=auth.JWT_ALGORITHM,
    )
    return f"Bearer {token}"


async def remember_user(db, claims: dict) -> None:
    """Keep the signed-in name, for the runs nobody starts from a browser."""
    name = (claims or {}).get("name") or ""
    if name:
        await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('user.name', ?)", (json.dumps(name),))
        await db.commit()


async def _user_name(db) -> str:
    async with db.execute("SELECT value FROM app_settings WHERE key='user.name'") as c:
        row = await c.fetchone()
    if row:
        return json.loads(row["value"])
    async with db.execute("SELECT name FROM user_profile WHERE id=1") as c:
        row = await c.fetchone()
    return (row["name"] if row else "") or ""


async def _service_auth_for(db) -> str:
    return service_auth(await _user_name(db))


async def _busy(db, session_id: str) -> bool:
    async with db.execute(
        "SELECT 1 FROM agent_runs WHERE session_id=? AND status IN ('running','awaiting_input') LIMIT 1", (session_id,),
    ) as c:
        return await c.fetchone() is not None


async def start_routine(routine_id: str, trigger: str = "schedule", test: bool = False) -> dict | None:
    """Run a routine now. Returns the new item, or None if it's already running.

    `test`: a test run, to see what it would do. Whatever the routine's
    setting, changes only become suggestions (nothing happens unless you
    approve one), there's no notification, and the item says it's a test."""
    from routers import assistant
    db = await connect()
    try:
        async with db.execute("SELECT * FROM routines WHERE id=?", (routine_id,)) as c:
            r = await c.fetchone()
        if not r:
            return None
        async with db.execute(
            "SELECT 1 FROM inbox_items WHERE routine_id=? AND status='running' LIMIT 1", (routine_id,),
        ) as c:
            if await c.fetchone():
                return None
        now = _now()
        session_id = await assistant.new_session_row(db, r["name"], kind="routine")
        run_id, item_id = str(uuid.uuid4()), uuid.uuid4().hex[:12]
        await db.execute(
            "INSERT INTO agent_runs (id, created_at, updated_at, status, prompt, user_message, session_id) "
            "VALUES (?,?,?, 'running', ?, ?, ?)", (run_id, now, now, r["prompt"][:500], r["prompt"], session_id),
        )
        await db.execute(
            "INSERT INTO inbox_items (id, created_at, updated_at, title, routine_id, session_id, status, read, test) "
            "VALUES (?,?,?,?,?,?, 'running', 0, ?)", (item_id, now, now, r["name"], routine_id, session_id, int(test)),
        )
        if not test:
            await db.execute("UPDATE routines SET last_run_at=? WHERE id=?", (now, routine_id))
        await db.commit()
        body = await assistant.run_body(
            db, run_id, session_id, [{"role": "user", "content": r["prompt"]}],
            background={"routine": r["name"], "approval": "ask" if test else r["approval"], "trigger": trigger, "test": test},
        )
        auth = await _service_auth_for(db)
        notify = bool(r["notify"]) and not test
    finally:
        await db.close()
    assistant._tasks[run_id] = asyncio.create_task(_drive_and_finish(item_id, run_id, body, auth, notify))
    return {"id": item_id, "session_id": session_id, "run_id": run_id}


class BusyError(Exception):
    pass


async def reply(item_id: str, message: str, auth: str) -> dict:
    """Carry on an item's thread. You're there now, so Atlas acts directly
    (its changes logged and undoable) rather than proposing."""
    from routers import assistant
    db = await connect()
    try:
        async with db.execute("SELECT * FROM inbox_items WHERE id=?", (item_id,)) as c:
            item = await c.fetchone()
        if not item:
            return None
        if await _busy(db, item["session_id"]):
            raise BusyError("Atlas is still working on this one.")
        history = await assistant._history(db, item["session_id"])
        now = _now()
        run_id = str(uuid.uuid4())
        await db.execute(
            "INSERT INTO agent_runs (id, created_at, updated_at, status, prompt, user_message, session_id) "
            "VALUES (?,?,?, 'running', ?, ?, ?)", (run_id, now, now, message[:500], message, item["session_id"]),
        )
        await db.execute("UPDATE inbox_items SET status='running', updated_at=?, read=1, archived=0 WHERE id=?", (now, item_id))
        await db.commit()
        body = await assistant.run_body(db, run_id, item["session_id"], [*history, {"role": "user", "content": message}])
    finally:
        await db.close()
    assistant._tasks[run_id] = asyncio.create_task(_drive_and_finish(item_id, run_id, body, auth, notify=False))
    return {"run_id": run_id}


async def _drive_and_finish(item_id: str, run_id: str, body: bytes, auth: str, notify: bool) -> None:
    from routers import assistant
    try:
        await assistant._drive_run(run_id, body, auth)
    finally:
        await asyncio.shield(finish_item(item_id, run_id, notify))


async def finish_item(item_id: str, run_id: str, notify: bool) -> None:
    db = await connect()
    try:
        async with db.execute("SELECT status, reply, error FROM agent_runs WHERE id=?", (run_id,)) as c:
            run = await c.fetchone()
        async with db.execute("SELECT * FROM inbox_items WHERE id=?", (item_id,)) as c:
            item = await c.fetchone()
        if not run or not item:
            return
        status = "done" if run["status"] == "done" else "error"
        preview = preview_of(run["reply"] or "") or (run["error"] or "Finished without a reply.")
        async with db.execute(
            "SELECT COUNT(*) FROM inbox_proposals WHERE session_id=? AND status='pending'", (item["session_id"],),
        ) as c:
            pending = (await c.fetchone())[0]
        # A reply you're watching doesn't need to come back as unread.
        await db.execute(
            "UPDATE inbox_items SET status=?, preview=?, updated_at=?, read=CASE WHEN ? THEN 0 ELSE read END WHERE id=?",
            (status, preview, _now(), 1 if notify else 0, item_id),
        )
        await db.commit()
        if notify:
            import push
            body = preview[:140] + (f" · {pending} to approve" if pending else "")
            await push.notify(db, item["title"], body, tag=item_id, url=f"/atlas/?inbox={item_id}")
    except Exception:
        log.exception("Couldn't finish inbox item %s", item_id)
    finally:
        await db.close()


async def item_view(db, item_id: str) -> dict | None:
    from routers import assistant
    async with db.execute(
        "SELECT i.*, r.name AS routine_name, r.approval AS approval FROM inbox_items i "
        "LEFT JOIN routines r ON r.id = i.routine_id WHERE i.id=?", (item_id,),
    ) as c:
        item = await c.fetchone()
    if not item:
        return None
    thread = await assistant._session_view(db, item["session_id"])
    async with db.execute(
        "SELECT id, run_id, created_at, tool, args, summary, status, result, undo_id, decided_at "
        "FROM inbox_proposals WHERE session_id=? ORDER BY created_at", (item["session_id"],),
    ) as c:
        proposals = [{**dict(p), "args": json.loads(p["args"])} for p in await c.fetchall()]
    for p in proposals:
        p.pop("result", None)
    return {**_item_row(item), "messages": thread["messages"], "active_run": thread["active_run"], "proposals": proposals}


def _item_row(r) -> dict:
    d = dict(r)
    d["read"], d["archived"] = bool(d["read"]), bool(d["archived"])
    if "test" in d:
        d["test"] = bool(d["test"])
    return d


async def list_items(db, view: str = "all", limit: int = 100) -> dict:
    where = {"all": "i.archived=0", "unread": "i.archived=0 AND i.read=0",
             "action": "i.archived=0 AND pending > 0", "archived": "i.archived=1"}.get(view, "i.archived=0")
    async with db.execute(
        "SELECT * FROM (SELECT i.*, r.name AS routine_name, "
        "(SELECT COUNT(*) FROM inbox_proposals p WHERE p.session_id=i.session_id AND p.status='pending') AS pending "
        f"FROM inbox_items i LEFT JOIN routines r ON r.id=i.routine_id) i WHERE {where} "
        "ORDER BY i.updated_at DESC LIMIT ?", (limit,),
    ) as c:
        items = [_item_row(r) for r in await c.fetchall()]
    return {"items": items, "counts": await counts(db)}


async def counts(db) -> dict:
    async with db.execute(
        "SELECT SUM(CASE WHEN read=0 THEN 1 ELSE 0 END), "
        "SUM(CASE WHEN (SELECT COUNT(*) FROM inbox_proposals p WHERE p.session_id=i.session_id AND p.status='pending')>0 THEN 1 ELSE 0 END), "
        "SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) "
        "FROM inbox_items i WHERE archived=0"
    ) as c:
        unread, action, running = await c.fetchone()
    return {"unread": unread or 0, "action": action or 0, "running": running or 0}


# ── Routines ─────────────────────────────────────────────────────────────────

ROUTINE_FIELDS = ("name", "prompt", "days", "time", "approval", "notify", "enabled")


def _clean(fields: dict) -> dict:
    out = {k: v for k, v in fields.items() if k in ROUTINE_FIELDS and v is not None}
    if "name" in out:
        out["name"] = " ".join(str(out["name"]).split())[:80]
        if not out["name"]:
            raise ValueError("Give the routine a name.")
    if "prompt" in out:
        out["prompt"] = str(out["prompt"]).strip()[:4000]
        if not out["prompt"]:
            raise ValueError("Say what the routine should do.")
    if "days" in out:
        if isinstance(out["days"], (list, tuple)):
            out["days"] = ",".join(out["days"])
        out["days"] = ",".join(parse_days(out["days"]))
    if "time" in out:
        t = parse_time(out["time"])
        out["time"] = f"{t.hour:02d}:{t.minute:02d}"
    if "approval" in out and out["approval"] not in ("ask", "auto"):
        raise ValueError("approval is 'ask' or 'auto'.")
    for k in ("notify", "enabled"):
        if k in out:
            out[k] = 1 if out[k] else 0
    return out


def routine_row(r) -> dict:
    d = dict(r)
    d["notify"], d["enabled"] = bool(d["notify"]), bool(d["enabled"])
    d["days"] = parse_days(d["days"])
    d["schedule"] = describe_schedule(",".join(d["days"]), d["time"])
    return d


async def list_routines(db) -> list[dict]:
    async with db.execute("SELECT * FROM routines ORDER BY time, name") as c:
        return [routine_row(r) for r in await c.fetchall()]


async def get_routine(db, routine_id: str) -> dict | None:
    async with db.execute("SELECT * FROM routines WHERE id=?", (routine_id,)) as c:
        r = await c.fetchone()
    return routine_row(r) if r else None


def _schedule_next(r: dict) -> str | None:
    if not r.get("enabled", 1):
        return None
    nxt = next_run(r["days"] if isinstance(r["days"], str) else ",".join(r["days"]), r["time"], datetime.now(timezone.utc))
    return nxt.isoformat() if nxt else None


async def create_routine(db, fields: dict) -> dict:
    f = {"days": ",".join(DAYS), "time": "08:00", "approval": "ask", "notify": 1, "enabled": 1, **_clean(fields)}
    if "name" not in f or "prompt" not in f:
        raise ValueError("A routine needs a name and what to do.")
    rid, now = uuid.uuid4().hex[:12], _now()
    await db.execute(
        "INSERT INTO routines (id, name, prompt, days, time, approval, notify, enabled, created_at, updated_at, next_run_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (rid, f["name"], f["prompt"], f["days"], f["time"], f["approval"], f["notify"], f["enabled"], now, now, _schedule_next(f)),
    )
    await db.commit()
    return await get_routine(db, rid)


async def update_routine(db, routine_id: str, fields: dict) -> dict | None:
    async with db.execute("SELECT * FROM routines WHERE id=?", (routine_id,)) as c:
        row = await c.fetchone()
    if not row:
        return None
    f = {**dict(row), **_clean(fields)}
    await db.execute(
        "UPDATE routines SET name=?, prompt=?, days=?, time=?, approval=?, notify=?, enabled=?, updated_at=?, next_run_at=? WHERE id=?",
        (f["name"], f["prompt"], f["days"], f["time"], f["approval"], f["notify"], f["enabled"], _now(), _schedule_next(f), routine_id),
    )
    await db.commit()
    return await get_routine(db, routine_id)


async def delete_routine(db, routine_id: str) -> bool:
    cur = await db.execute("DELETE FROM routines WHERE id=?", (routine_id,))
    await db.commit()
    return cur.rowcount > 0


# ── The scheduler ────────────────────────────────────────────────────────────

async def run_due(now: datetime | None = None) -> list[str]:
    """Start every routine whose time has come. Returns the ids started."""
    now = now or datetime.now(timezone.utc)
    db = await connect()
    due = []
    try:
        async with db.execute(
            "SELECT * FROM routines WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at <= ?", (now.isoformat(),),
        ) as c:
            rows = [dict(r) for r in await c.fetchall()]
        for r in rows:
            nxt = next_run(r["days"], r["time"], now)
            await db.execute("UPDATE routines SET next_run_at=? WHERE id=?", (nxt.isoformat() if nxt else None, r["id"]))
            if now - datetime.fromisoformat(r["next_run_at"]) <= LATE_LIMIT:
                due.append(r["id"])
            else:
                log.info("Skipping %s: missed its slot by more than %s", r["name"], LATE_LIMIT)
        await db.commit()
    finally:
        await db.close()
    started = []
    for rid in due:
        if await start_routine(rid, "schedule"):
            started.append(rid)
    return started


async def scheduler() -> None:
    """The background loop: routines that are due, and the hourly snapshot."""
    import snapshots
    while True:
        try:
            await run_due()
        except Exception:
            log.exception("Routine scheduler tick failed")
        await snapshots.maybe_take()
        try:
            import conversations
            await conversations.purge_now()
        except Exception:
            log.exception("Couldn't clear finished chats")
        await asyncio.sleep(TICK_SECONDS)


# ── Tools for Atlas ──────────────────────────────────────────────────────────
# So "every weekday at 7:30, plan my day" can be set up by asking.

from mcp.types import Tool  # noqa: E402

_DAYS_SCHEMA = {"type": "array", "items": {"type": "string", "enum": DAYS},
                "description": "Days it runs, e.g. [\"mon\",\"tue\",\"wed\",\"thu\",\"fri\"]. Default every day."}
_ROUTINE_PROPS = {
    "name": {"type": "string", "description": "Short title, shown in the inbox"},
    "prompt": {"type": "string", "description": "What to do each time, written as an instruction to yourself; "
                                                "you won't have this conversation then, so include everything needed"},
    "days": _DAYS_SCHEMA,
    "time": {"type": "string", "description": "Local time HH:MM (24h)"},
    "approval": {"type": "string", "enum": ["ask", "auto"],
                 "description": "ask (default): changes you'd make wait for the user's approval in the inbox. "
                                "auto: make them directly (still logged and undoable)"},
    "notify": {"type": "boolean", "description": "Send a notification when it's done (default true)"},
}

TOOLS = [
    Tool(name="list_routines", description="List the user's routines: background jobs that run you on a schedule and leave the result in their inbox.",
         inputSchema={"type": "object", "properties": {}, "required": []}),
    Tool(name="create_routine",
         description="Set up a routine: you run in the background on a schedule (e.g. weekdays at 07:30) and leave the result in the user's inbox, with a notification. Use for anything recurring: a morning plan, a weekly money check, a Sunday review.",
         inputSchema={"type": "object", "properties": _ROUTINE_PROPS, "required": ["name", "prompt"]}),
    Tool(name="update_routine", description="Change a routine (id from list_routines). Only pass what changes. enabled=false pauses it.",
         inputSchema={"type": "object", "properties": {"id": {"type": "string"}, **_ROUTINE_PROPS, "enabled": {"type": "boolean"}}, "required": ["id"]}),
    Tool(name="delete_routine", description="Delete a routine. Its past inbox items stay.",
         inputSchema={"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}),
    Tool(name="run_routine", description="Run a routine now, in the background; the result arrives in the inbox. test=true does a test run: nothing is changed (changes become suggestions) and there's no notification.",
         inputSchema={"type": "object", "properties": {"id": {"type": "string"}, "test": {"type": "boolean"}}, "required": ["id"]}),
    Tool(name="list_inbox", description="List recent inbox items (results of routines): id, title, when, status, suggestions waiting, and a preview. Use to find an item to open with show(view='inbox', inbox_item_id=…).",
         inputSchema={"type": "object", "properties": {"limit": {"type": "integer", "description": "default 15"}}, "required": []}),
]
NAMES = {t.name for t in TOOLS}


async def dispatch(name: str, args: dict, db) -> dict:
    import agent_actions as actions
    from agent_actions import snapshot, restore_rows, delete_rows
    show = {"kind": "page", "page": "inbox"}
    try:
        if name == "list_inbox":
            out = await list_items(db, "all", limit=max(1, min(int(args.get("limit") or 15), 50)))
            return {"items": [{k: i.get(k) for k in ("id", "title", "created_at", "status", "pending", "read", "test", "preview", "routine_id")}
                              for i in out["items"]], "counts": out["counts"]}
        if name == "list_routines":
            return {"routines": [{k: r[k] for k in ("id", "name", "prompt", "schedule", "approval", "notify", "enabled", "next_run_at")}
                                 for r in await list_routines(db)]}
        if name == "create_routine":
            r = await create_routine(db, args)
            undo_id = await actions.record(db, name, f"Created routine “{r['name']}” ({r['schedule']})",
                                           {"sql": delete_rows("routines", "id", [r["id"]])}, {"kind": "routine", "id": r["id"]})
            return {"ok": True, "routine": r, "undo_id": undo_id, "show": {"kind": "routine", "id": r["id"]}}
        if name in ("update_routine", "delete_routine"):
            before = await snapshot(db, "routines", "id = ?", (args.get("id"),))
            if not before:
                return {"error": "No routine with that id"}
            if name == "delete_routine":
                await delete_routine(db, args["id"])
                summary = f"Deleted routine “{before[0]['name']}”"
                out = {"ok": True}
            else:
                r = await update_routine(db, args["id"], {k: v for k, v in args.items() if k != "id"})
                summary = f"Changed routine “{r['name']}” ({r['schedule']}{'' if r['enabled'] else ', paused'})"
                from agent_cards import change_card
                b = before[0]
                card = change_card(f"Routine · {r['name']}", [
                    ("Name", b["name"], r["name"]), ("When", describe_schedule(b["days"], b["time"]), r["schedule"]),
                    ("Instruction", b["prompt"], r["prompt"]), ("Asks first", "yes" if b["approval"] == "ask" else "no", "yes" if r["approval"] == "ask" else "no"),
                    ("On", "yes" if b["enabled"] else "no", "yes" if r["enabled"] else "no")], show)
                out = {"ok": True, "routine": r, "card": card}
            routine_show = {"kind": "routine", "id": args["id"]} if name == "update_routine" else show
            out["undo_id"] = await actions.record(db, name, summary, {"sql": restore_rows("routines", before)}, routine_show)
            out["show"] = routine_show
            return out
        if name == "run_routine":
            item = await start_routine(args.get("id", ""), "manual", test=bool(args.get("test")))
            return ({"ok": True, "started": item, "show": {"kind": "inbox", "id": item["id"]}} if item
                    else {"error": "No such routine, or it's already running"})
    except ValueError as exc:
        return {"error": str(exc)}
    return {"error": f"Unknown tool {name}"}
