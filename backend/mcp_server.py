"""
Atlas MCP Server — exposes dashboard data as MCP tools over SSE transport.
Auth: Bearer token must match ATLAS_MCP_KEY env var.
Mount on FastAPI: app.mount("/mcp", mcp_app)
"""
import os
import json
from datetime import datetime, timezone

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

    return {"error": f"Unknown tool: {name}"}


# ── SSE Transport + auth middleware ───────────────────────────────────────────

sse_transport = SseServerTransport("/mcp/messages/")


async def _check_auth(request: Request) -> bool:
    if not ATLAS_MCP_KEY:
        return True  # no key configured → open (dev mode)
    auth = request.headers.get("authorization", "")
    key = request.query_params.get("key", "")
    return auth == f"Bearer {ATLAS_MCP_KEY}" or key == ATLAS_MCP_KEY


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
