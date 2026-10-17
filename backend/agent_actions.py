"""
The action log: every change the assistant makes, and how to take it back.

The assistant has free rein over the dashboard — calendar, to-dos, finances,
notes. That is only comfortable if any change can be undone, so each writing
tool records what it did (`summary`) and a recipe for reversing it (`undo`)
before it returns. The chat shows the summary with an Undo button, and the
Assistant settings list recent changes.

An undo recipe is JSON:
  {"sql":  [[statement, params], ...],          # run in order, one transaction
   "gcal": [{"method", "path", "body"}, ...]}   # Google Calendar API calls

Database changes are undone from a snapshot of the rows taken *before* the
change (restore_rows / delete_rows below). Calendar changes are undone with
the opposite API call, using the event as it was before.

An undo is not itself undoable, and undoing an old change after later ones
touched the same thing puts back the old state over them — the UI asks first.
"""
import json
import uuid
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Building recipes ─────────────────────────────────────────────────────────

async def snapshot(db, table: str, where: str, params=()) -> list[dict]:
    """The rows a change is about to touch, as they are now."""
    async with db.execute(f"SELECT * FROM {table} WHERE {where}", params) as c:
        return [dict(r) for r in await c.fetchall()]


def restore_rows(table: str, rows: list[dict]) -> list:
    """SQL that puts these rows back exactly as they were."""
    out = []
    for r in rows:
        cols = list(r)
        out.append([f"INSERT OR REPLACE INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                    [r[c] for c in cols]])
    return out


def delete_rows(table: str, key: str, values) -> list:
    """SQL that removes rows a change created."""
    return [[f"DELETE FROM {table} WHERE {key} = ?", [v]] for v in values]


# ── The log ──────────────────────────────────────────────────────────────────

async def record(db, tool: str, summary: str, undo: dict | None, show: dict | None = None) -> str:
    """Log a change. Returns its id, which the tool result carries as `undo_id`."""
    action_id = uuid.uuid4().hex[:12]
    await db.execute(
        "INSERT INTO agent_actions (id, created_at, tool, summary, undo, show) VALUES (?,?,?,?,?,?)",
        (action_id, _now(), tool, summary, json.dumps(undo) if undo else None, json.dumps(show) if show else None),
    )
    await db.commit()
    return action_id


async def show_for(db, action_id: str) -> dict | None:
    """Where to look to see a logged change."""
    async with db.execute("SELECT show FROM agent_actions WHERE id = ?", (action_id,)) as c:
        row = await c.fetchone()
    return json.loads(row[0]) if row and row[0] else None


async def recent(db, limit: int = 30) -> list[dict]:
    async with db.execute(
        "SELECT id, created_at, tool, summary, undone_at, undo IS NOT NULL AS undoable, show "
        "FROM agent_actions ORDER BY created_at DESC LIMIT ?", (limit,),
    ) as c:
        rows = [dict(r) for r in await c.fetchall()]
    for r in rows:
        r["undoable"] = bool(r["undoable"]) and not r["undone_at"]
        r["show"] = json.loads(r["show"]) if r["show"] else None
    return rows


class UndoError(Exception):
    pass


async def undo(db, action_id: str) -> dict:
    """Reverse one logged change."""
    async with db.execute("SELECT * FROM agent_actions WHERE id = ?", (action_id,)) as c:
        row = await c.fetchone()
    if not row:
        raise UndoError("No such change.")
    if row["undone_at"]:
        raise UndoError("That change has already been undone.")
    if not row["undo"]:
        raise UndoError("That change can't be undone.")
    recipe = json.loads(row["undo"])

    # Calendar first: if Google refuses, nothing local has changed yet.
    if recipe.get("gcal"):
        from mcp_server import _gcal_write   # lazy: mcp_server imports this module
        for op in recipe["gcal"]:
            ok, data = await _gcal_write(db, op["method"], op.get("path", ""), op.get("body"))
            # Gone already counts as undone (e.g. the event was deleted by hand since).
            if not ok and not ("404" in str(data) or "410" in str(data)):
                raise UndoError(f"Google Calendar: {data}")

    for stmt, params in recipe.get("sql", []):
        await db.execute(stmt, params)
    await db.execute("UPDATE agent_actions SET undone_at = ? WHERE id = ?", (_now(), action_id))
    await db.commit()
    return {"ok": True, "id": action_id, "summary": row["summary"]}
