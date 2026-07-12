"""
Atlas MCP Server — exposes dashboard data as MCP tools over SSE transport.
Auth: Bearer token must match ATLAS_MCP_KEY env var.
Mount on FastAPI: app.mount("/mcp", mcp_app)
"""
import os
import json
import base64
from datetime import datetime, timezone

import httpx

import aiosqlite
from mcp.server import Server
from mcp.server.sse import SseServerTransport
from mcp.types import Tool, TextContent
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Mount, Route

DATABASE_PATH = os.getenv("DATABASE_PATH", "./atlas.db")
ATLAS_MCP_KEY = os.getenv("ATLAS_MCP_KEY", "")


def _gh_headers(token):
    return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}


async def _get_github_creds(db):
    async with db.execute(
        "SELECT github_token, github_repo FROM user_integrations WHERE github_token IS NOT NULL LIMIT 1"
    ) as c:
        row = await c.fetchone()
    if not row or not row["github_token"]:
        return None, None
    return row["github_token"], row["github_repo"]

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
    return [
        Tool(name="list_todos", description="List todos, optionally filtered by bucket (today/week/someday)", inputSchema={"type":"object","properties":{"bucket":{"type":"string","enum":["today","week","someday"]}},"required":[]}),
        Tool(name="add_todo", description="Add a new todo", inputSchema={"type":"object","properties":{"text":{"type":"string"},"bucket":{"type":"string","enum":["today","week","someday"]},"goal_id":{"type":"string"}},"required":["text","bucket"]}),
        Tool(name="complete_todo", description="Mark a todo as done", inputSchema={"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}),
        Tool(name="move_todo", description="Move a todo to a different bucket", inputSchema={"type":"object","properties":{"id":{"type":"string"},"bucket":{"type":"string","enum":["today","week","someday"]}},"required":["id","bucket"]}),
        Tool(name="get_week_outcomes", description="Get the weekly outcomes / intentions text", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="list_habits", description="List all habits with today's completion status", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="log_habit", description="Toggle a habit completion for a date (defaults to today)", inputSchema={"type":"object","properties":{"id":{"type":"string"},"date":{"type":"string"}},"required":["id"]}),
        Tool(name="list_goals", description="List all annual goals with quarterly focus text", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="get_finances_summary", description="Get net worth, total saved in pots, income and spending", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="list_transactions", description="List recent transactions", inputSchema={"type":"object","properties":{"limit":{"type":"integer","default":20}},"required":[]}),
        Tool(name="list_notes", description="List quick notes (local)", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="search_notes", description="Search notes by keyword", inputSchema={"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}),
        Tool(name="create_note", description="Create a new quick note", inputSchema={"type":"object","properties":{"body":{"type":"string"}},"required":["body"]}),
        Tool(name="update_note", description="Update an existing note body", inputSchema={"type":"object","properties":{"id":{"type":"string"},"body":{"type":"string"}},"required":["id","body"]}),
        Tool(name="list_events", description="List local calendar events, optionally for a specific date (YYYY-MM-DD)", inputSchema={"type":"object","properties":{"date":{"type":"string"}},"required":[]}),
        Tool(name="delete_todo", description="Delete a todo permanently", inputSchema={"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}),
        Tool(name="set_week_outcomes", description="Set the weekly outcomes / intentions text", inputSchema={"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}),
        Tool(name="get_today_summary", description="Get a full summary of today: pending todos, habit completions, calendar events, and weekly outcomes — useful for a daily briefing", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="list_github_notes", description="List all markdown files in the connected GitHub repo", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="read_github_note", description="Read a GitHub note by path. Checks local drafts first, then falls back to GitHub.", inputSchema={"type":"object","properties":{"path":{"type":"string","description":"File path e.g. folder/note.md"}},"required":["path"]}),
        Tool(name="write_github_note", description="Save a GitHub note as a local draft (will appear in the UI for review before publishing). Adds .md extension if missing.", inputSchema={"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}),
        Tool(name="create_github_folder", description="Create a new folder draft in the GitHub notes (saves README.md as a draft for review before publishing)", inputSchema={"type":"object","properties":{"path":{"type":"string","description":"Folder path e.g. ideas/2024"}},"required":["path"]}),
        Tool(name="list_github_drafts", description="List all pending GitHub note drafts (created/edited via MCP, not yet published to GitHub)", inputSchema={"type":"object","properties":{},"required":[]}),
        Tool(name="read_github_draft", description="Read the content of a specific GitHub note draft by path", inputSchema={"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict):
    db = await _db()
    try:
        result = await _dispatch(name, arguments, db)
    finally:
        await db.close()
    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]


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
        return {"id": new_id, "ok": True}

    if name == "complete_todo":
        await db.execute("UPDATE todos SET done = NOT done WHERE id = ?", (args["id"],))
        await db.commit()
        return {"ok": True}

    if name == "move_todo":
        await db.execute("UPDATE todos SET bucket = ? WHERE id = ?", (args["bucket"], args["id"]))
        await db.commit()
        return {"ok": True}

    if name == "get_week_outcomes":
        # Get Monday of current week
        from datetime import timedelta
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
        else:
            await db.execute("INSERT INTO habit_completions (habit_id,date) VALUES (?,?)", (args["id"], date))
        await db.commit()
        return {"ok": True, "now_done": not exists}

    if name == "list_goals":
        async with db.execute("SELECT * FROM goals ORDER BY created_at") as c:
            return [dict(r) for r in await c.fetchall()]

    if name == "get_finances_summary":
        async with db.execute("SELECT SUM(balance) as total FROM finances_accounts") as c:
            row = await c.fetchone()
            net_worth = row["total"] or 0
        async with db.execute("SELECT SUM(d.amount) as saved FROM finances_deposits d") as c:
            row = await c.fetchone()
            total_saved = row["saved"] or 0
        async with db.execute("SELECT SUM(amount) as v FROM finances_transactions WHERE type='income'") as c:
            income = (await c.fetchone())["v"] or 0
        async with db.execute("SELECT SUM(amount) as v FROM finances_transactions WHERE type='expense'") as c:
            spending = (await c.fetchone())["v"] or 0
        return {"net_worth": net_worth, "total_saved": total_saved, "income": income, "spending": spending}

    if name == "list_transactions":
        limit = args.get("limit", 20)
        async with db.execute("SELECT * FROM finances_transactions ORDER BY date DESC LIMIT ?", (limit,)) as c:
            return [dict(r) for r in await c.fetchall()]

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
        return {"id": new_id, "ok": True}

    if name == "update_note":
        await db.execute("UPDATE notes SET body=?, updated_at=? WHERE id=?", (args["body"], today, args["id"]))
        await db.commit()
        return {"ok": True}

    if name == "list_events":
        date = args.get("date")
        if date:
            async with db.execute("SELECT * FROM local_events WHERE date=? ORDER BY start_h", (date,)) as c:
                return [dict(r) for r in await c.fetchall()]
        async with db.execute("SELECT * FROM local_events ORDER BY date, start_h") as c:
            return [dict(r) for r in await c.fetchall()]

    if name == "delete_todo":
        await db.execute("DELETE FROM todos WHERE id = ?", (args["id"],))
        await db.commit()
        return {"ok": True}

    if name == "set_week_outcomes":
        from datetime import timedelta
        d = datetime.now(timezone.utc).date()
        monday = (d - timedelta(days=d.weekday())).isoformat()
        await db.execute(
            "INSERT INTO week_outcomes (week_str, text) VALUES (?, ?) ON CONFLICT(week_str) DO UPDATE SET text=excluded.text",
            (monday, args["text"]),
        )
        await db.commit()
        return {"ok": True, "week": monday}

    if name == "get_today_summary":
        from datetime import timedelta
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

        # Today's calendar events
        async with db.execute("SELECT title, start_h, end_h, color FROM local_events WHERE date=? ORDER BY start_h", (today,)) as c:
            events = [dict(r) for r in await c.fetchall()]

        # Weekly outcomes
        async with db.execute("SELECT text FROM week_outcomes WHERE week_str=?", (monday,)) as c:
            row = await c.fetchone()
        outcomes = row["text"] if row else ""

        return {
            "date": today,
            "week_outcomes": outcomes,
            "todos": {
                "pending": pending_todos,
                "done": done_todos,
            },
            "habits": habits,
            "calendar_events": events,
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
        from datetime import datetime, timezone
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
        await db.execute(
            "INSERT INTO github_drafts (path, content, saved_at) VALUES (?, ?, ?)"
            " ON CONFLICT(path) DO UPDATE SET content=excluded.content, saved_at=excluded.saved_at",
            (path, content, now),
        )
        await db.commit()
        return {"ok": True, "path": path, "status": "saved as draft — open Atlas to review and publish"}

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

    return {"error": f"Unknown tool: {name}"}


# ── SSE Transport + auth middleware ───────────────────────────────────────────

sse_transport = SseServerTransport("/messages/")


async def _check_auth(request: Request) -> bool:
    if not ATLAS_MCP_KEY:
        return True  # no key configured → open (dev mode)
    auth = request.headers.get("authorization", "")
    key = request.query_params.get("key", "")
    # Accept static bearer key
    if auth == f"Bearer {ATLAS_MCP_KEY}" or key == ATLAS_MCP_KEY:
        return True
    # Accept JWT issued by our OAuth server
    if auth.startswith("Bearer "):
        token = auth[7:]
        try:
            from auth import decode_jwt
            decode_jwt(token)
            return True
        except Exception:
            pass
    return False


async def handle_sse(request: Request) -> Response:
    if not await _check_auth(request):
        return Response("Unauthorized", status_code=401)
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
