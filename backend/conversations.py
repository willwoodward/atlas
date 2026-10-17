"""
Chats are temporary unless you keep them.

A chat with the assistant (an agent_sessions row of kind 'chat', its runs and
their events) is deleted once it's over: closed with "New chat", or idle past
the session timeout (ASSISTANT_SESSION_MINUTES, 30). "Keep" marks it kept:
kept chats are listed under past chats, can be renamed, reopened and carried
on, and are only deleted when you delete them.

Not affected: inbox threads (sessions of kind 'routine' — the inbox manages
those), the assistant's memory, and the action log behind Undo (what changed,
not what was said).

The purge runs on every scheduler tick (inbox.scheduler) and at startup.
"""
import os
from datetime import datetime, timedelta, timezone

IDLE_MINUTES = int(os.getenv("ASSISTANT_SESSION_MINUTES", "30"))


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _delete_runs(db, where: str, params) -> int:
    async with db.execute(f"SELECT id FROM agent_runs WHERE {where}", params) as c:
        ids = [r[0] for r in await c.fetchall()]
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        marks = ",".join("?" * len(chunk))
        await db.execute(f"DELETE FROM agent_run_events WHERE run_id IN ({marks})", chunk)
        await db.execute(f"DELETE FROM agent_runs WHERE id IN ({marks})", chunk)
    return len(ids)


async def delete_session(db, session_id: str) -> None:
    await _delete_runs(db, "session_id = ?", (session_id,))
    await db.execute("DELETE FROM agent_sessions WHERE id = ?", (session_id,))


async def purge(db, now: datetime | None = None) -> dict:
    """Delete temporary chats that are over. Returns what went."""
    now = now or _now()
    cutoff = (now - timedelta(minutes=IDLE_MINUTES)).isoformat()
    async with db.execute(
        "SELECT id FROM agent_sessions s WHERE kind = 'chat' AND kept = 0 "
        "AND (closed = 1 OR updated_at < ?) "
        "AND NOT EXISTS (SELECT 1 FROM agent_runs r WHERE r.session_id = s.id AND r.status IN ('running','awaiting_input'))",
        (cutoff,),
    ) as c:
        sessions = [r[0] for r in await c.fetchall()]
    for sid in sessions:
        await delete_session(db, sid)
    # Runs from before sessions existed (or sent without one), once finished.
    loose = await _delete_runs(db, "session_id IS NULL AND status NOT IN ('running','awaiting_input') AND updated_at < ?", (cutoff,))
    await db.commit()
    return {"sessions": len(sessions), "loose_runs": loose}


async def purge_now() -> dict:
    import inbox
    db = await inbox.connect()
    try:
        return await purge(db)
    finally:
        await db.close()
