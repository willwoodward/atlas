"""
The assistant's editable documents: its memory and its system prompt.

  memory — standing notes (routines, rules, preferences) the assistant keeps
           for itself. Starts empty.
  prompt — its system prompt: who it is and how it works. Starts as
           assistant_prompt.DEFAULT_PROMPT.

Both are editable from the Assistant settings and by the assistant itself
through MCP tools. A session takes a snapshot of both when it starts and uses
that snapshot for every turn (see routers/assistant.py), so a change applies
from the next conversation rather than shifting under the current one.

Each save appends a version rather than overwriting. That is what makes giving
the assistant free rein safe: whatever it writes, the previous version is one
restore away.
"""
from datetime import datetime, timezone

from assistant_prompt import DEFAULT_PROMPT

# Generous for notes, small next to a model's context.
MAX_CHARS = 20_000
SOURCES = ("user", "assistant", "restore")
DEFAULTS = {"memory": "", "prompt": DEFAULT_PROMPT}
KINDS = tuple(DEFAULTS)


class MemoryEditError(ValueError):
    """A save that cannot be applied (too long, edit text not found…)."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _check_kind(kind: str) -> None:
    if kind not in DEFAULTS:
        raise MemoryEditError(f"Unknown document {kind!r}")


def _row(r) -> dict:
    return {"version": r[0], "content": r[1], "created_at": r[2], "source": r[3]}


async def current(db, kind: str = "memory") -> dict:
    """The latest version, or the default with version None."""
    _check_kind(kind)
    async with db.execute(
        "SELECT version, content, created_at, source FROM assistant_memory "
        "WHERE kind=? ORDER BY version DESC LIMIT 1", (kind,),
    ) as c:
        row = await c.fetchone()
    if not row:
        return {"version": None, "content": DEFAULTS[kind], "created_at": None, "source": None}
    return _row(row)


async def content_at(db, kind: str, number: int | None) -> str:
    """The text of a version; None or 0 means the default."""
    if not number:
        return DEFAULTS[kind]
    v = await version(db, number, kind)
    return v["content"] if v else DEFAULTS[kind]


async def save(db, content: str, source: str, kind: str = "memory") -> dict:
    """Store `content` as a new version. Returns it along with the version it replaced."""
    _check_kind(kind)
    if source not in SOURCES:
        raise MemoryEditError(f"Unknown source {source!r}")
    content = (content or "").replace("\r\n", "\n")
    if len(content) > MAX_CHARS:
        raise MemoryEditError(f"Limited to {MAX_CHARS} characters (this is {len(content)}).")
    if kind == "prompt" and not content.strip():
        raise MemoryEditError("The system prompt can't be empty. Reset it to the default instead.")
    before = await current(db, kind)
    if content == before["content"]:
        return {**before, "previous_version": before["version"], "unchanged": True}
    cur = await db.execute(
        "INSERT INTO assistant_memory (content, created_at, source, kind) VALUES (?,?,?,?)",
        (content, _now(), source, kind),
    )
    await db.commit()
    saved = await version(db, cur.lastrowid, kind)
    return {**saved, "previous_version": before["version"]}


async def edit(db, old_text: str, new_text: str, source: str, kind: str = "memory") -> dict:
    """Replace one exact passage. Must match exactly once, so the change is unambiguous."""
    text = (await current(db, kind))["content"]
    if not old_text:
        raise MemoryEditError("old_text is empty — rewrite the whole document instead.")
    count = text.count(old_text)
    if count == 0:
        raise MemoryEditError("old_text was not found. Read the document again and copy the passage exactly.")
    if count > 1:
        raise MemoryEditError(f"old_text appears {count} times. Include more surrounding text so it matches once.")
    return await save(db, text.replace(old_text, new_text, 1), source, kind)


async def version(db, number: int, kind: str = "memory") -> dict | None:
    async with db.execute(
        "SELECT version, content, created_at, source FROM assistant_memory WHERE version=? AND kind=?",
        (number, kind),
    ) as c:
        row = await c.fetchone()
    return _row(row) if row else None


async def history(db, limit: int = 30, kind: str = "memory") -> list[dict]:
    _check_kind(kind)
    async with db.execute(
        "SELECT version, content, created_at, source FROM assistant_memory "
        "WHERE kind=? ORDER BY version DESC LIMIT ?", (kind, limit),
    ) as c:
        return [_row(r) for r in await c.fetchall()]


async def restore(db, number: int, kind: str = "memory") -> dict:
    """Make an old version current again — as a new version, so the restore can itself be undone.

    Version 0 is the default (empty memory, the original prompt), so the first
    edit ever made can be undone like any other.
    """
    _check_kind(kind)
    if number == 0:
        return await save(db, DEFAULTS[kind], "restore", kind)
    old = await version(db, number, kind)
    if not old:
        raise MemoryEditError(f"No {kind} version {number}.")
    return await save(db, old["content"], "restore", kind)
