"""
Atlas MCP Server — exposes dashboard data as MCP tools over SSE transport.
Auth: Bearer token must match ATLAS_MCP_KEY env var.
Mount on FastAPI: app.mount("/mcp", mcp_app)
"""
import os
import json
import base64
import time as _time
from datetime import datetime, date as _date, time as _clock, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx

import aiosqlite
import assistant_memory
import agent_actions as actions
import agent_tools
import agent_cards
from agent_cards import change_card, note_card
import inbox
from agent_actions import snapshot, restore_rows, delete_rows
from crypto import enc, dec
from mcp.server import Server
from mcp.server.sse import SseServerTransport
from mcp.types import Tool, TextContent
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Mount, Route

DATABASE_PATH = os.getenv("DATABASE_PATH", "./atlas.db")
ATLAS_MCP_KEY = os.getenv("ATLAS_MCP_KEY", "")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GCAL_TOKEN_URL = "https://oauth2.googleapis.com/token"
GCAL_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
TIMEZONE = os.getenv("TZ", "Europe/London")

# How much transaction detail the assistant may see. The agent container talks
# to a third-party model, so merchant-level spending history leaves this box
# whenever the tools are callable.
#   full     — everything, merchant names included (default: the user chose
#              this on 2026-10-17 so Atlas can investigate and categorise)
#   redacted — dates, amounts and categories, but no merchant names
#   off      — no transaction-level tools at all
MCP_TRANSACTIONS = os.getenv("ATLAS_MCP_TRANSACTIONS", "full").strip().lower()
# Finance tools that read individual transactions; hidden when off.
_TXN_TOOLS = {"finance_breakdown", "compare_spending", "search_transactions", "list_categories",
              "list_recurring", "get_budgets", "set_transaction_category", "rename_category", "add_category_rule"}


def _gh_headers(token):
    return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}


async def _get_github_creds(db):
    async with db.execute(
        "SELECT github_token, github_repo FROM user_integrations WHERE github_token IS NOT NULL LIMIT 1"
    ) as c:
        row = await c.fetchone()
    if not row or not row["github_token"]:
        return None, None
    return dec(row["github_token"]), row["github_repo"]

# ── Google Calendar ───────────────────────────────────────────────────────────
# The frontend reads GCal directly from the browser, so those events never touch
# the database. To let the tools see the same calendar the user sees, we refresh
# the stored refresh_token server-side — same flow as GET /auth/gcal/token.


async def _gcal_token(db) -> str | None:
    """Return a valid GCal access token, refreshing and re-caching if needed."""
    async with db.execute(
        "SELECT email, gcal_refresh_token, gcal_access_token, gcal_access_expires_at "
        "FROM user_integrations WHERE gcal_refresh_token IS NOT NULL LIMIT 1"
    ) as c:
        row = await c.fetchone()
    if not row:
        return None

    now = int(_time.time())
    if row["gcal_access_token"] and row["gcal_access_expires_at"] and row["gcal_access_expires_at"] > now + 300:
        cached = dec(row["gcal_access_token"])
        if cached:
            return cached

    if not GOOGLE_CLIENT_SECRET:
        return None
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(GCAL_TOKEN_URL, data={
            "refresh_token": dec(row["gcal_refresh_token"]),
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "grant_type": "refresh_token",
        })
    if resp.status_code != 200:
        return None

    data = resp.json()
    token = data["access_token"]
    await db.execute(
        "UPDATE user_integrations SET gcal_access_token=?, gcal_access_expires_at=? WHERE email=?",
        (enc(token), now + data.get("expires_in", 3600) - 60, row["email"]),
    )
    await db.commit()
    return token


async def _gcal_events(db, day_from: _date, day_to: _date) -> list[dict]:
    """Fetch GCal events for an inclusive local-time date range. [] if unavailable."""
    token = await _gcal_token(db)
    if not token:
        return []

    tz = ZoneInfo(TIMEZONE)
    time_min = datetime.combine(day_from, _clock.min, tz)
    time_max = datetime.combine(day_to + timedelta(days=1), _clock.min, tz)

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                GCAL_EVENTS_URL,
                headers={"Authorization": f"Bearer {token}"},
                params={
                    "timeMin": time_min.isoformat(),
                    "timeMax": time_max.isoformat(),
                    "singleEvents": "true",
                    "orderBy": "startTime",
                    "maxResults": "100",
                },
            )
    except httpx.HTTPError:
        return []
    if resp.status_code != 200:
        return []

    events = []
    for e in resp.json().get("items", []):
        if e.get("status") == "cancelled":
            continue
        start, end = e.get("start", {}), e.get("end", {})
        all_day = "date" in start
        events.append({
            "source": "google",
            "id": e.get("id"),  # needed to update/delete the event later
            "title": e.get("summary") or "(No title)",
            "date": start.get("date") or (start.get("dateTime") or "")[:10],
            "start": start.get("date") or start.get("dateTime"),
            "end": end.get("date") or end.get("dateTime"),
            "all_day": all_day,
            "location": e.get("location", ""),
            "description": e.get("description", ""),
            "color": _GCAL_COLOR_NAMES.get(e.get("colorId"), "default"),
        })
    return events


def _rfc3339(date_str: str, hour: float) -> str:
    """('2026-08-03', 14.5) -> '2026-08-03T14:30:00+01:00' in the user's timezone."""
    h, m = int(hour), round((hour % 1) * 60)
    base = datetime.combine(_date.fromisoformat(date_str), _clock.min, ZoneInfo(TIMEZONE))
    return (base + timedelta(hours=h, minutes=m)).isoformat()


async def _gcal_write(db, method: str, path: str = "", json_body: dict | None = None):
    """Call the GCal events API. Returns (ok, data_or_error_string)."""
    token = await _gcal_token(db)
    if not token:
        return False, "Google Calendar is not connected"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.request(
                method,
                f"{GCAL_EVENTS_URL}{path}",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=json_body,
            )
    except httpx.HTTPError as exc:
        return False, f"Could not reach Google Calendar: {exc}"
    if resp.status_code not in (200, 201, 204):
        return False, f"Google Calendar rejected the request ({resp.status_code}): {resp.text[:200]}"
    return True, (resp.json() if resp.content and resp.status_code != 204 else {})


async def _gcal_get(db, event_id: str) -> dict | None:
    """One Google event as stored, for undo snapshots."""
    ok, data = await _gcal_write(db, "GET", f"/{event_id}")
    return data if ok and isinstance(data, dict) and data.get("id") else None


# Fields that can be put back on a Google event to undo an edit.
_GCAL_FIELDS = ("summary", "description", "location", "start", "end", "colorId")


def _gcal_recreate_body(ev: dict) -> dict:
    return {k: ev[k] for k in _GCAL_FIELDS if k in ev}


# Atlas shows Google's 11 event colours as six of its own (see
# frontend/src/integrations/googleCalendar.js COLOR_MAP). Either name works.
_GCAL_COLORS = {
    "coral": "6", "sage": "2", "blue": "9", "gold": "5", "mauve": "3", "grey": "8", "gray": "8", "stone": "8",
    "lavender": "1", "grape": "3", "flamingo": "4", "banana": "5", "tangerine": "6", "peacock": "7",
    "graphite": "8", "blueberry": "9", "basil": "10", "tomato": "11",
}
ATLAS_COLOR_NAMES = ["coral", "sage", "blue", "gold", "mauve", "grey", "default"]
# colorId → the Atlas colour it's shown as.
_GCAL_COLOR_NAMES = {"1": "mauve", "2": "sage", "3": "mauve", "4": "coral", "5": "gold", "6": "coral",
                     "7": "blue", "8": "grey", "9": "blue", "10": "sage", "11": "coral"}


def _gcal_color_id(name: str) -> str | None:
    """A colour name (or Google colorId) → colorId; "default" → None (calendar colour)."""
    n = str(name).strip().lower()
    if n in ("default", "none", ""):
        return None
    if n.isdigit() and 1 <= int(n) <= 11:
        return n
    return _GCAL_COLORS.get(n, "9")


def _gcal_when(ev: dict | None) -> str | None:
    """'Tue 21 Oct, 14:00–15:00' (or the date alone for an all-day event)."""
    if not ev:
        return None
    s, e = (ev.get("start") or {}), (ev.get("end") or {})
    if s.get("date") and not s.get("dateTime"):
        return datetime.fromisoformat(s["date"]).strftime("%a %-d %b") + ", all day"
    if not s.get("dateTime"):
        return None
    a = datetime.fromisoformat(s["dateTime"].replace("Z", "+00:00"))
    out = a.strftime("%a %-d %b, %H:%M")
    if e.get("dateTime"):
        out += "–" + datetime.fromisoformat(e["dateTime"].replace("Z", "+00:00")).strftime("%H:%M")
    return out


def _first_line(body: str) -> str:
    line = next((l for l in (body or "").splitlines() if l.strip()), "Untitled")
    return line.lstrip("# ").strip()[:60]


server = Server("atlas")


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def _db():
    db = await aiosqlite.connect(DATABASE_PATH)
    db.row_factory = aiosqlite.Row
    return db


# ── Tool definitions ──────────────────────────────────────────────────────────

@server.list_tools()
async def list_tools() -> list[Tool]:
    tools = [
        Tool(name="list_todos", description="List todos, optionally filtered by bucket (today/week/someday)", inputSchema={"type":"object","properties":{"bucket":{"type":"string","enum":["today","week","someday"]}},"required":[]}),
        Tool(name="add_todo", description="Add a new todo", inputSchema={"type":"object","properties":{"text":{"type":"string"},"bucket":{"type":"string","enum":["today","week","someday"]},"goal_id":{"type":"string"}},"required":["text","bucket"]}),
        Tool(name="complete_todo", description="Mark a todo as done", inputSchema={"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}),
        Tool(name="move_todo", description="Move a todo to a different bucket", inputSchema={"type":"object","properties":{"id":{"type":"string"},"bucket":{"type":"string","enum":["today","week","someday"]}},"required":["id","bucket"]}),
        Tool(name="get_week_outcomes", description="Get the weekly outcomes / intentions text", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="list_habits", description="List all habits with today's completion status", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="log_habit", description="Toggle a habit completion for a date (defaults to today)", inputSchema={"type":"object","properties":{"id":{"type":"string"},"date":{"type":"string"}},"required":["id"]}),
        Tool(name="list_goals", description="List all annual goals with quarterly focus text", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="get_finances_summary", description="Get net worth, total saved in pots, and all-time income and spending, converted to EUR at ECB rates", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="list_notes", description="List quick notes (local)", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="search_notes", description="Search notes by keyword", inputSchema={"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}),
        Tool(name="create_note", description="Create a new quick note", inputSchema={"type":"object","properties":{"body":{"type":"string"}},"required":["body"]}),
        Tool(name="update_note", description="Update an existing note body", inputSchema={"type":"object","properties":{"id":{"type":"string"},"body":{"type":"string"}},"required":["id","body"]}),
        Tool(name="list_events", description="List calendar events — both the user's Google Calendar and local Atlas events. Pass a date (YYYY-MM-DD) for a single day; without one you get local events plus the next 7 days of Google Calendar. Each event has a 'source' of 'google' or 'local'.", inputSchema={"type":"object","properties":{"date":{"type":"string"}},"required":[]}),
        Tool(name="create_event", description="Create a calendar event in the user's Google Calendar. Times are local (Europe/London) decimal hours: 14.5 = 2:30pm. For an all-day event pass all_day=true and omit start/end.", inputSchema={"type":"object","properties":{"title":{"type":"string"},"date":{"type":"string","description":"YYYY-MM-DD"},"start":{"type":"number","description":"Start hour, e.g. 9.25 for 9:15am"},"end":{"type":"number","description":"End hour, e.g. 10.5 for 10:30am"},"description":{"type":"string"},"location":{"type":"string"},"all_day":{"type":"boolean"},"color":{"type":"string","enum":["coral","sage","blue","gold","mauve","grey","default"],"description":"Event colour as Atlas shows it; default = the calendar colour"}},"required":["title","date"]}),
        Tool(name="update_event", description="Update, reschedule or recolour an existing Google Calendar event. Use the event 'id' from list_events. Only pass the fields you want to change.", inputSchema={"type":"object","properties":{"id":{"type":"string"},"title":{"type":"string"},"date":{"type":"string","description":"YYYY-MM-DD — required if changing start/end"},"start":{"type":"number"},"end":{"type":"number"},"description":{"type":"string"},"location":{"type":"string"},"color":{"type":"string","enum":["coral","sage","blue","gold","mauve","grey","default"],"description":"Event colour as Atlas shows it; default = the calendar colour"}},"required":["id"]}),
        Tool(name="delete_event", description="Delete a Google Calendar event by its 'id' from list_events", inputSchema={"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}),
        Tool(name="delete_todo", description="Delete a todo permanently", inputSchema={"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}),
        Tool(name="set_week_outcomes", description="Set the weekly outcomes / intentions text", inputSchema={"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}),
        Tool(name="get_today_summary", description="Get a full summary of today: pending todos, habit completions, calendar events (Google Calendar + local), and weekly outcomes — useful for a daily briefing", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="list_github_notes", description="List all markdown files in the connected GitHub repo", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="read_github_note", description="Read a GitHub note by path. Checks local drafts first, then falls back to GitHub.", inputSchema={"type":"object","properties":{"path":{"type":"string","description":"File path e.g. folder/note.md"}},"required":["path"]}),
        Tool(name="write_github_note", description="Save a GitHub note as a local draft (will appear in the UI for review before publishing). Adds .md extension if missing.", inputSchema={"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}),
        Tool(name="create_github_folder", description="Create a new folder draft in the GitHub notes (saves README.md as a draft for review before publishing)", inputSchema={"type":"object","properties":{"path":{"type":"string","description":"Folder path e.g. ideas/2024"}},"required":["path"]}),
        Tool(name="list_github_drafts", description="List all pending GitHub note drafts (created/edited via MCP, not yet published to GitHub)", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="read_github_draft", description="Read the content of a specific GitHub note draft by path", inputSchema={"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}),
        Tool(name="read_memory", description="Read the assistant's memory: the standing notes (routines, rules, preferences) loaded into the assistant's context at the start of every conversation. Returns the latest text and its version.", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="write_memory", description="Replace the assistant's whole memory with new text (markdown). Use for reorganising or larger rewrites; read_memory first so nothing is lost. Applies from the next conversation. Every version is kept and the user can undo.", inputSchema={"type":"object","properties":{"content":{"type":"string"}},"required":["content"]}),
        Tool(name="edit_memory", description="Change one passage of the assistant's memory: old_text must match exactly once and is replaced by new_text (use an empty new_text to delete it). To add something, pass a nearby line, e.g. a section heading, as old_text and the same line plus the addition as new_text. Applies from the next conversation.", inputSchema={"type":"object","properties":{"old_text":{"type":"string"},"new_text":{"type":"string"}},"required":["old_text","new_text"]}),
        Tool(name="read_system_prompt", description="Read the assistant's system prompt: its instructions for who it is and how it works. {name} and {today} in it are filled in at the start of each conversation. Returns the latest text and its version.", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="write_system_prompt", description="Replace the assistant's whole system prompt. read_system_prompt first and keep what still applies. Applies from the next conversation. Every version is kept and the user can undo.", inputSchema={"type":"object","properties":{"content":{"type":"string"}},"required":["content"]}),
        Tool(name="edit_system_prompt", description="Change one passage of the assistant's system prompt: old_text must match exactly once and is replaced by new_text. Applies from the next conversation.", inputSchema={"type":"object","properties":{"old_text":{"type":"string"},"new_text":{"type":"string"}},"required":["old_text","new_text"]}),
    ]

    if MCP_TRANSACTIONS in ("redacted", "full"):
        detail = ("Merchant names are redacted." if MCP_TRANSACTIONS == "redacted"
                  else "Includes merchant names.")
        tools.append(Tool(
            name="list_transactions",
            description=f"List recent transactions. {detail}",
            inputSchema={"type": "object", "properties": {"limit": {"type": "integer", "default": 20}}, "required": []},
        ))

    tools += [t for t in agent_tools.TOOLS if MCP_TRANSACTIONS != "off" or t.name not in _TXN_TOOLS]
    tools += agent_cards.TOOLS
    tools += inbox.TOOLS
    return tools


@server.call_tool()
async def call_tool(name: str, arguments: dict):
    db = await _db()
    try:
        result = await run_tool(name, arguments, db)
    finally:
        await db.close()
    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]


async def run_tool(name: str, args: dict, db):
    """Run a tool. A change also says where to see it (`show`), so the app
    can follow along as the assistant works."""
    # A background run set to "ask": changes wait in the inbox for approval.
    ctx = inbox.RUN_CONTEXT.get()
    if ctx and ctx.get("approval") == "ask" and name in inbox.WRITE_TOOLS:
        return await inbox.propose(db, name, args, ctx)
    if name in inbox.NAMES:
        result = await inbox.dispatch(name, args, db)
    else:
        result = await _dispatch(name, args, db)
    if isinstance(result, dict) and result.get("undo_id") and "show" not in result:
        show = await actions.show_for(db, result["undo_id"])
        if show:
            result["show"] = show
    return result


async def _dispatch(name: str, args: dict, db: aiosqlite.Connection):
    today = _today()

    if name == "list_todos":
        bucket = args.get("bucket")
        if bucket:
            async with db.execute("SELECT * FROM todos WHERE bucket = ? ORDER BY sort_order", (bucket,)) as c:
                return [dict(r) for r in await c.fetchall()]
        async with db.execute("SELECT * FROM todos ORDER BY bucket, sort_order") as c:
            return [dict(r) for r in await c.fetchall()]

    if name == "add_todo":
        import uuid as _uuid
        new_id = str(_uuid.uuid4())
        bucket = args.get("bucket", "today")
        async with db.execute("SELECT COALESCE(MAX(sort_order),-1)+1 FROM todos WHERE bucket=?", (bucket,)) as c:
            order = (await c.fetchone())[0]
        await db.execute(
            "INSERT INTO todos (id,text,bucket,goal_id,done,created_at,sort_order) VALUES (?,?,?,?,0,?,?)",
            (new_id, args["text"], bucket, args.get("goal_id"), today, order),
        )
        await db.commit()
        undo_id = await actions.record(db, name, f"Added to-do “{args['text']}”",
                                       {"sql": delete_rows("todos", "id", [new_id])}, {"kind": "todo", "id": new_id})
        return {"id": new_id, "ok": True, "undo_id": undo_id}

    if name == "complete_todo":
        before = await snapshot(db, "todos", "id = ?", (args["id"],))
        if not before:
            return {"error": "No to-do with that id"}
        await db.execute("UPDATE todos SET done = NOT done WHERE id = ?", (args["id"],))
        await db.commit()
        verb = "Reopened" if before[0]["done"] else "Completed"
        undo_id = await actions.record(db, name, f"{verb} “{before[0]['text']}”",
                                       {"sql": restore_rows("todos", before)}, {"kind": "todo", "id": args["id"]})
        b = before[0]
        return {"ok": True, "done": not b["done"], "undo_id": undo_id,
                "card": {"type": "todos", "title": "To-do", "rows": [{"id": b["id"], "text": b["text"], "bucket": b["bucket"], "done": not b["done"]}]}}

    if name == "move_todo":
        before = await snapshot(db, "todos", "id = ?", (args["id"],))
        if not before:
            return {"error": "No to-do with that id"}
        await db.execute("UPDATE todos SET bucket = ? WHERE id = ?", (args["bucket"], args["id"]))
        await db.commit()
        undo_id = await actions.record(db, name, f"Moved “{before[0]['text']}” to {args['bucket']}",
                                       {"sql": restore_rows("todos", before)}, {"kind": "todo", "id": args["id"]})
        labels = agent_cards.BUCKET_LABEL
        return {"ok": True, "undo_id": undo_id,
                "card": change_card(f"To-do · {before[0]['text']}", [("List", labels.get(before[0]["bucket"], before[0]["bucket"]), labels.get(args["bucket"], args["bucket"]))],
                                    {"kind": "todo", "id": args["id"]})}

    if name == "get_week_outcomes":
        # Get Monday of current week
        d = datetime.now(timezone.utc).date()
        monday = (d - timedelta(days=d.weekday())).isoformat()
        async with db.execute("SELECT text FROM week_outcomes WHERE week_str = ?", (monday,)) as c:
            row = await c.fetchone()
        return {"week": monday, "text": row["text"] if row else ""}

    if name == "list_habits":
        async with db.execute("SELECT * FROM habits ORDER BY created_at") as c:
            habits = [dict(r) for r in await c.fetchall()]
        for h in habits:
            async with db.execute(
                "SELECT 1 FROM habit_completions WHERE habit_id=? AND date=?", (h["id"], today)
            ) as c:
                h["done_today"] = bool(await c.fetchone())
        return habits

    if name == "log_habit":
        date = args.get("date", today)
        async with db.execute(
            "SELECT 1 FROM habit_completions WHERE habit_id=? AND date=?", (args["id"], date)
        ) as c:
            exists = await c.fetchone()
        if exists:
            await db.execute("DELETE FROM habit_completions WHERE habit_id=? AND date=?", (args["id"], date))
            undo = {"sql": [["INSERT OR IGNORE INTO habit_completions (habit_id,date) VALUES (?,?)", [args["id"], date]]]}
        else:
            await db.execute("INSERT INTO habit_completions (habit_id,date) VALUES (?,?)", (args["id"], date))
            undo = {"sql": [["DELETE FROM habit_completions WHERE habit_id=? AND date=?", [args["id"], date]]]}
        await db.commit()
        async with db.execute("SELECT name FROM habits WHERE id=?", (args["id"],)) as c:
            h = await c.fetchone()
        undo_id = await actions.record(db, name, f"{'Unticked' if exists else 'Ticked'} “{h['name'] if h else 'habit'}” for {date}",
                                       undo, {"kind": "habit", "id": args["id"]})
        return {"ok": True, "now_done": not exists, "undo_id": undo_id}

    if name == "list_goals":
        async with db.execute("SELECT * FROM goals ORDER BY created_at") as c:
            return [dict(r) for r in await c.fetchall()]

    if name == "get_finances_summary":
        # Everything in EUR: balances at the latest ECB rate, transactions at
        # the rate on their own date (same rules as the Finances page).
        import fx
        async with db.execute("SELECT currency FROM finances_accounts UNION SELECT currency FROM finances_transactions UNION SELECT currency FROM finances_pots") as c:
            currencies = {r["currency"] for r in await c.fetchall()}
        async with db.execute("SELECT MIN(date) AS d FROM finances_transactions") as c:
            oldest = (await c.fetchone())["d"]
        table = await fx.ensure(db, currencies, since=oldest)
        missing = set()

        def eur(amount, cur, on=None):
            try:
                return table.convert(float(amount or 0), (cur or "EUR").upper(), "EUR", on)
            except fx.NoRate:
                missing.add(cur)
                return 0.0

        async with db.execute("SELECT type, balance, currency FROM finances_accounts") as c:
            net_worth = sum((-1 if r["type"] == "credit" else 1) * eur(r["balance"], r["currency"]) for r in await c.fetchall())
        async with db.execute("SELECT d.amount, p.currency FROM finances_deposits d JOIN finances_pots p ON p.id = d.pot_id") as c:
            total_saved = sum(eur(r["amount"], r["currency"]) for r in await c.fetchall())
        async with db.execute("SELECT type, amount, currency, date FROM finances_transactions") as c:
            txns = await c.fetchall()
        income = sum(eur(t["amount"], t["currency"], t["date"]) for t in txns if t["type"] == "income")
        spending = sum(eur(t["amount"], t["currency"], t["date"]) for t in txns if t["type"] == "expense")
        out = {"currency": "EUR", "net_worth": round(net_worth, 2), "total_saved": round(total_saved, 2),
               "income_all_time": round(income, 2), "spending_all_time": round(spending, 2)}
        if missing:
            out["excluded_currencies_without_rates"] = sorted(missing)
        return out

    if name == "list_transactions":
        # Belt and braces: the tool is hidden when disabled, but a client that
        # cached an older tool list could still call it.
        if MCP_TRANSACTIONS not in ("redacted", "full"):
            return {"error": "Transaction access is disabled. Set ATLAS_MCP_TRANSACTIONS to enable it."}
        limit = args.get("limit", 20)
        async with db.execute("SELECT * FROM finances_transactions ORDER BY date DESC LIMIT ?", (limit,)) as c:
            rows = [dict(r) for r in await c.fetchall()]
        if MCP_TRANSACTIONS == "redacted":
            for r in rows:
                r["merchant"] = "[redacted]"
        return rows

    if name == "list_notes":
        async with db.execute("SELECT * FROM notes ORDER BY updated_at DESC") as c:
            return [dict(r) for r in await c.fetchall()]

    if name == "search_notes":
        q = f"%{args['query']}%"
        async with db.execute("SELECT * FROM notes WHERE body LIKE ? ORDER BY updated_at DESC", (q,)) as c:
            return [dict(r) for r in await c.fetchall()]

    if name == "create_note":
        import uuid as _uuid
        new_id = str(_uuid.uuid4())
        await db.execute("INSERT INTO notes (id,body,updated_at) VALUES (?,?,?)", (new_id, args["body"], today))
        await db.commit()
        undo_id = await actions.record(db, name, f"Created note “{_first_line(args['body'])}”",
                                       {"sql": delete_rows("notes", "id", [new_id])}, {"kind": "note", "id": new_id})
        return {"id": new_id, "ok": True, "undo_id": undo_id, "card": note_card(new_id, args["body"])}

    if name == "update_note":
        before = await snapshot(db, "notes", "id = ?", (args["id"],))
        if not before:
            return {"error": "No note with that id"}
        await db.execute("UPDATE notes SET body=?, updated_at=? WHERE id=?", (args["body"], today, args["id"]))
        await db.commit()
        undo_id = await actions.record(db, name, f"Edited note “{_first_line(before[0]['body'])}”",
                                       {"sql": restore_rows("notes", before)}, {"kind": "note", "id": args["id"]})
        return {"ok": True, "undo_id": undo_id, "card": note_card(args["id"], args["body"])}

    if name == "list_events":
        date = args.get("date")
        if date:
            async with db.execute("SELECT * FROM local_events WHERE date=? ORDER BY start_h", (date,)) as c:
                local = [dict(r) | {"source": "local"} for r in await c.fetchall()]
            day = _date.fromisoformat(date)
            return local + await _gcal_events(db, day, day)

        # No date given — local events are few, but bound the GCal window.
        async with db.execute("SELECT * FROM local_events ORDER BY date, start_h") as c:
            local = [dict(r) | {"source": "local"} for r in await c.fetchall()]
        start = datetime.now(ZoneInfo(TIMEZONE)).date()
        return local + await _gcal_events(db, start, start + timedelta(days=7))

    if name == "create_event":
        date_str, title = args["date"], args["title"]
        body = {"summary": title}
        if args.get("description"):
            body["description"] = args["description"]
        if args.get("location"):
            body["location"] = args["location"]

        if args.get("all_day"):
            nxt = (_date.fromisoformat(date_str) + timedelta(days=1)).isoformat()
            body["start"] = {"date": date_str}
            body["end"] = {"date": nxt}  # GCal all-day end is exclusive
        else:
            start_h = args.get("start")
            if start_h is None:
                return {"error": "start is required for a timed event (or pass all_day=true)"}
            end_h = args.get("end", start_h + 1)
            if end_h <= start_h:
                return {"error": "end must be after start"}
            body["start"] = {"dateTime": _rfc3339(date_str, start_h), "timeZone": TIMEZONE}
            body["end"] = {"dateTime": _rfc3339(date_str, end_h), "timeZone": TIMEZONE}

        if args.get("color"):
            body["colorId"] = _gcal_color_id(args["color"])
        ok, data = await _gcal_write(db, "POST", "", body)
        if not ok:
            return {"error": data}
        undo_id = await actions.record(db, name, f"Added “{title}” on {date_str}",
                                       {"gcal": [{"method": "DELETE", "path": f"/{data.get('id')}"}]},
                                       {"kind": "event", "id": data.get("id"), "date": date_str})
        return {"ok": True, "id": data.get("id"), "title": title, "date": date_str, "source": "google", "undo_id": undo_id}

    if name == "update_event":
        body = {}
        if args.get("title"):
            body["summary"] = args["title"]
        if args.get("description") is not None:
            body["description"] = args["description"]
        if args.get("location") is not None:
            body["location"] = args["location"]

        if args.get("start") is not None or args.get("end") is not None:
            date_str = args.get("date")
            if not date_str:
                return {"error": "date is required when changing start or end"}
            if args.get("start") is not None:
                body["start"] = {"dateTime": _rfc3339(date_str, args["start"]), "timeZone": TIMEZONE}
            if args.get("end") is not None:
                body["end"] = {"dateTime": _rfc3339(date_str, args["end"]), "timeZone": TIMEZONE}

        if args.get("color"):
            body["colorId"] = _gcal_color_id(args["color"])
        if not body:
            return {"error": "Nothing to update — pass at least one field to change"}

        before = await _gcal_get(db, args["id"])
        ok, data = await _gcal_write(db, "PATCH", f"/{args['id']}", body)
        if not ok:
            return {"error": data}
        # Put back every field this edit touched; one that was unset before is
        # cleared (null for colour, empty text for the rest).
        restore = ({k: before.get(k, None if k in ("colorId", "start", "end") else "") for k in body}
                   if before else None)
        ev_date = ((data.get("start") or {}).get("dateTime") or (data.get("start") or {}).get("date") or "")[:10]
        undo_id = await actions.record(db, name, f"Changed “{(before or data).get('summary', 'event')}”",
                                       {"gcal": [{"method": "PATCH", "path": f"/{args['id']}", "body": restore}]} if restore else None,
                                       {"kind": "event", "id": args["id"], "date": ev_date})
        after = {**(before or {}), **body}
        card = change_card(f"Event · {data.get('summary') or 'event'}", [
            ("Title", (before or {}).get("summary"), after.get("summary")),
            ("When", _gcal_when(before), _gcal_when(after)),
            ("Where", (before or {}).get("location"), after.get("location")),
            ("Colour", _GCAL_COLOR_NAMES.get((before or {}).get("colorId")) or "default", _GCAL_COLOR_NAMES.get(after.get("colorId")) or "default"),
        ], {"kind": "event", "id": args["id"], "date": ev_date})
        return {"ok": True, "id": data.get("id"), "title": data.get("summary"), "date": ev_date, "undo_id": undo_id, "card": card}

    if name == "delete_event":
        before = await _gcal_get(db, args["id"])
        ok, data = await _gcal_write(db, "DELETE", f"/{args['id']}")
        if not ok:
            return {"error": data}
        # Undo recreates it (Google gives the copy a new id).
        undo_id = await actions.record(db, name, f"Deleted “{(before or {}).get('summary', 'event')}”",
                                       {"gcal": [{"method": "POST", "path": "", "body": _gcal_recreate_body(before)}]} if before else None)
        return {"ok": True, "id": args["id"], "undo_id": undo_id}

    if name == "delete_todo":
        before = await snapshot(db, "todos", "id = ?", (args["id"],))
        if not before:
            return {"error": "No to-do with that id"}
        await db.execute("DELETE FROM todos WHERE id = ?", (args["id"],))
        await db.commit()
        undo_id = await actions.record(db, name, f"Deleted to-do “{before[0]['text']}”",
                                       {"sql": restore_rows("todos", before)}, {"kind": "todo", "id": args["id"]})
        return {"ok": True, "undo_id": undo_id}

    if name == "set_week_outcomes":
        d = datetime.now(timezone.utc).date()
        monday = (d - timedelta(days=d.weekday())).isoformat()
        before = await snapshot(db, "week_outcomes", "week_str = ?", (monday,))
        await db.execute(
            "INSERT INTO week_outcomes (week_str, text) VALUES (?, ?) ON CONFLICT(week_str) DO UPDATE SET text=excluded.text",
            (monday, args["text"]),
        )
        await db.commit()
        undo = {"sql": restore_rows("week_outcomes", before) if before else delete_rows("week_outcomes", "week_str", [monday])}
        undo_id = await actions.record(db, name, "Updated this week's outcomes", undo, {"kind": "page", "page": "todos"})
        return {"ok": True, "week": monday, "undo_id": undo_id,
                "card": change_card("This week's outcomes", [("Outcomes", before[0]["text"] if before else None, args["text"])], {"kind": "page", "page": "todos"})}

    if name == "get_today_summary":
        d = datetime.now(timezone.utc).date()
        monday = (d - timedelta(days=d.weekday())).isoformat()

        # Pending todos (today bucket, not done)
        async with db.execute("SELECT id, text, goal_id FROM todos WHERE bucket='today' AND done=0 ORDER BY sort_order") as c:
            pending_todos = [dict(r) for r in await c.fetchall()]

        # Done todos today
        async with db.execute("SELECT id, text FROM todos WHERE bucket='today' AND done=1 ORDER BY sort_order") as c:
            done_todos = [dict(r) for r in await c.fetchall()]

        # Habits with completion status
        async with db.execute("SELECT id, name, color FROM habits ORDER BY created_at") as c:
            habits = [dict(r) for r in await c.fetchall()]
        for h in habits:
            async with db.execute("SELECT 1 FROM habit_completions WHERE habit_id=? AND date=?", (h["id"], today)) as c:
                h["done_today"] = bool(await c.fetchone())

        # Today's calendar events — local Atlas events plus the real Google calendar
        async with db.execute("SELECT title, start_h, end_h, color FROM local_events WHERE date=? ORDER BY start_h", (today,)) as c:
            events = [dict(r) | {"source": "local"} for r in await c.fetchall()]
        events += await _gcal_events(db, d, d)

        # Weekly outcomes
        async with db.execute("SELECT text FROM week_outcomes WHERE week_str=?", (monday,)) as c:
            row = await c.fetchone()
        outcomes = row["text"] if row else ""

        # Drawn in the chat / inbox: the day as a timeline, the open to-dos as
        # a checklist — so a morning summary needn't retype either.
        day = await agent_tools.dispatch("show_day", {"date": today}, db, gcal_events=_gcal_events)
        todo_card = await agent_cards.dispatch("show_todos", {"bucket": "open"}, db)
        return {
            "date": today,
            "week_outcomes": outcomes,
            "todos": {
                "pending": pending_todos,
                "done": done_todos,
            },
            "habits": habits,
            "calendar_events": events,
            "cards": [{**day["card"], "show": day["show"]}, {**todo_card["card"], "show": todo_card["show"]}],
            "note": "The user sees today's timeline and to-do checklist as cards: don't list them again in text.",
        }

    if name == "list_github_notes":
        token, repo = await _get_github_creds(db)
        if not token:
            return {"error": "GitHub not connected"}
        async with httpx.AsyncClient() as client:
            r = await client.get(f"https://api.github.com/repos/{repo}", headers=_gh_headers(token))
            branch = r.json()["default_branch"]
            r = await client.get(f"https://api.github.com/repos/{repo}/git/trees/{branch}?recursive=1", headers=_gh_headers(token))
        files = [f["path"] for f in r.json().get("tree", []) if f["type"] == "blob" and f["path"].endswith(".md")]
        return {"files": files, "count": len(files)}

    if name == "read_github_note":
        path = args["path"]
        # Check local draft first
        async with db.execute("SELECT content, saved_at FROM github_drafts WHERE path=?", (path,)) as c:
            draft_row = await c.fetchone()
        if draft_row:
            return {"path": path, "content": draft_row["content"], "saved_at": draft_row["saved_at"], "source": "draft"}
        # Fall back to GitHub
        token, repo = await _get_github_creds(db)
        if not token:
            return {"error": "GitHub not connected"}
        async with httpx.AsyncClient() as client:
            r = await client.get(f"https://api.github.com/repos/{repo}/contents/{path}", headers=_gh_headers(token))
        if r.status_code == 404:
            return {"error": "File not found"}
        data = r.json()
        content = base64.b64decode(data["content"]).decode("utf-8")
        return {"path": path, "content": content, "sha": data["sha"], "source": "github"}

    if name in ("write_github_note", "create_github_folder"):
        if name == "create_github_folder":
            folder = args["path"].rstrip("/")
            path = f"{folder}/README.md"
            content = f"# {folder.split('/')[-1]}\n"
        else:
            path = args["path"]
            if not path.endswith(".md"):
                path += ".md"
            content = args["content"]
        now = datetime.now(timezone.utc).isoformat()
        before = await snapshot(db, "github_drafts", "path = ?", (path,))
        await db.execute(
            "INSERT INTO github_drafts (path, content, saved_at) VALUES (?, ?, ?)"
            " ON CONFLICT(path) DO UPDATE SET content=excluded.content, saved_at=excluded.saved_at",
            (path, content, now),
        )
        await db.commit()
        undo = {"sql": restore_rows("github_drafts", before) if before else delete_rows("github_drafts", "path", [path])}
        undo_id = await actions.record(db, name, f"Saved draft {path}", undo, {"kind": "github", "path": path})
        return {"ok": True, "path": path, "status": "saved as draft — open Atlas to review and publish", "undo_id": undo_id}

    if name == "list_github_drafts":
        async with db.execute("SELECT path, saved_at FROM github_drafts ORDER BY saved_at DESC") as c:
            rows = [dict(r) for r in await c.fetchall()]
        return {"drafts": rows, "count": len(rows)}

    if name == "read_github_draft":
        path = args["path"]
        async with db.execute("SELECT path, content, saved_at FROM github_drafts WHERE path=?", (path,)) as c:
            row = await c.fetchone()
        if not row:
            return {"error": "Draft not found"}
        return dict(row)

    doc = {"read_memory": "memory", "write_memory": "memory", "edit_memory": "memory",
           "read_system_prompt": "prompt", "write_system_prompt": "prompt",
           "edit_system_prompt": "prompt"}.get(name)
    if doc and name.startswith("read_"):
        cur = await assistant_memory.current(db, doc)
        return {"version": cur["version"], "content": cur["content"],
                "max_chars": assistant_memory.MAX_CHARS}
    if doc:
        try:
            if name.startswith("write_"):
                saved = await assistant_memory.save(db, args.get("content", ""), "assistant", doc)
            else:
                saved = await assistant_memory.edit(db, args.get("old_text", ""), args.get("new_text", ""), "assistant", doc)
        except assistant_memory.MemoryEditError as exc:
            return {"error": str(exc)}
        # previous_version is what the chat's Undo restores (0 = the default).
        return {"ok": True, "document": doc, "version": saved["version"],
                "previous_version": saved["previous_version"] or 0,
                "unchanged": saved.get("unchanged", False),
                "applies": "from the next conversation"}

    if name in agent_cards.NAMES:
        if name in ("spending_trend", "net_worth_trend") and MCP_TRANSACTIONS == "off":
            return {"error": "Transaction access is disabled on this server (ATLAS_MCP_TRANSACTIONS=off)."}
        result = await agent_cards.dispatch(name, args, db, gcal_events=_gcal_events)
        if result is not None:
            return result

    if name in agent_tools.NAMES:
        if name in _TXN_TOOLS and MCP_TRANSACTIONS == "off":
            return {"error": "Transaction access is disabled on this server (ATLAS_MCP_TRANSACTIONS=off)."}
        result = await agent_tools.dispatch(name, args, db, gcal_events=_gcal_events)
        if result is not None:
            if MCP_TRANSACTIONS == "redacted":
                _redact(result)
            return result

    return {"error": f"Unknown tool: {name}"}


def _redact(result):
    """ATLAS_MCP_TRANSACTIONS=redacted: strip merchant names from any result."""
    if isinstance(result, dict):
        for k, v in result.items():
            if k == "merchant":
                result[k] = "[redacted]"
            else:
                _redact(v)
        if result.get("by") == "merchant":
            for r in result.get("rows", []):
                if isinstance(r, dict) and "label" in r:
                    r["label"] = "[redacted]"
    elif isinstance(result, list):
        for v in result:
            _redact(v)


# ── SSE Transport + auth middleware ───────────────────────────────────────────

sse_transport = SseServerTransport("/messages/")


# An unset key used to mean "open". That fails open: one missing variable in the
# environment silently published every tool to the internet. It now fails closed,
# and local dev has to say so explicitly.
ALLOW_INSECURE = os.getenv("ATLAS_MCP_ALLOW_INSECURE", "").strip().lower() in ("1", "true", "yes")
# A key in the URL ends up in proxy logs and history. Header only, unless a
# client that can't send headers needs it switched on.
ALLOW_QUERY_KEY = os.getenv("ATLAS_MCP_ALLOW_QUERY_KEY", "").strip().lower() in ("1", "true", "yes", "on")


async def _check_auth(request: Request) -> bool:
    import secrets as _secrets

    if not ATLAS_MCP_KEY:
        return ALLOW_INSECURE

    auth = request.headers.get("authorization", "")
    key = request.query_params.get("key", "")
    if auth.startswith("Bearer ") and _secrets.compare_digest(auth[7:], ATLAS_MCP_KEY):
        return True
    if ALLOW_QUERY_KEY and key and _secrets.compare_digest(key, ATLAS_MCP_KEY):
        return True

    # A JWT is accepted only if it was minted for MCP. Any token will otherwise
    # do, including the app session token from a browser.
    if auth.startswith("Bearer "):
        try:
            from auth import decode_jwt, AUD_MCP
            decode_jwt(auth[7:], audience=AUD_MCP)
            return True
        except Exception:
            pass
    return False


async def handle_sse(request: Request) -> Response:
    if not await _check_auth(request):
        return Response("Unauthorized", status_code=401)
    # Which run this connection serves, and whether its changes must wait for
    # approval (see inbox.py). Tool calls on the connection inherit this.
    run_id = request.headers.get("x-atlas-run")
    if run_id:
        inbox.RUN_CONTEXT.set({"run_id": run_id, "approval": request.headers.get("x-atlas-approval", "auto")})
    async with sse_transport.connect_sse(request.scope, request.receive, request._send) as streams:
        await server.run(streams[0], streams[1], server.create_initialization_options())
    return Response()


async def handle_messages(request: Request) -> Response:
    if not await _check_auth(request):
        return Response("Unauthorized", status_code=401)
    await sse_transport.handle_post_message(request.scope, request.receive, request._send)
    return Response()


mcp_app = Starlette(
    routes=[
        Route("/sse", handle_sse),
        Mount("/messages/", app=sse_transport.handle_post_message),
    ]
)
