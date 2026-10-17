"""
A daily record of things that otherwise only exist as their current value.

Transactions, habit check-ins, completed to-dos and weekly outcomes already
carry dates, so their history is already there. Balances don't: an account
row holds today's balance and nothing else. So once an hour the scheduler
(inbox.scheduler) writes the current values under today's date — the day's
row ends up as that day's last value — and charts read them back.

  net_worth          EUR, accounts (credit cards count against)
  saved              EUR, total in pots
  account:<id>       that account's balance, in its own currency
  open_todos         to-dos not done (today + this week + someday)
"""
import logging
import time
from datetime import date

log = logging.getLogger("atlas.snapshots")
EVERY_SECONDS = 3600
_last = 0.0


async def take(db, day: date | None = None) -> dict:
    """Record today's values. Returns what was written."""
    import mcp_server
    day = (day or date.today()).isoformat()
    values = {}
    summary = await mcp_server._dispatch("get_finances_summary", {}, db)
    if isinstance(summary, dict) and "net_worth" in summary:
        values["net_worth"] = summary["net_worth"]
        values["saved"] = summary["total_saved"]
    async with db.execute("SELECT id, balance FROM finances_accounts") as c:
        for r in await c.fetchall():
            values[f"account:{r['id']}"] = float(r["balance"] or 0)
    async with db.execute("SELECT COUNT(*) FROM todos WHERE done = 0") as c:
        values["open_todos"] = (await c.fetchone())[0]
    for key, value in values.items():
        await db.execute("INSERT OR REPLACE INTO daily_snapshots (date, key, value) VALUES (?,?,?)", (day, key, float(value)))
    await db.commit()
    return values


async def maybe_take() -> None:
    """At most once an hour (called on every scheduler tick)."""
    global _last
    if time.monotonic() - _last < EVERY_SECONDS:
        return
    _last = time.monotonic()
    import inbox
    db = await inbox.connect()
    try:
        await take(db)
    except Exception:
        log.exception("Couldn't record today's snapshot")
    finally:
        await db.close()


async def value_on_or_before(db, key: str, day: str, not_before: str | None = None) -> float | None:
    """The last recorded value on or before `day` (and not before `not_before`)."""
    sql = "SELECT value FROM daily_snapshots WHERE key=? AND date<=?" + (" AND date>=?" if not_before else "") + " ORDER BY date DESC LIMIT 1"
    async with db.execute(sql, (key, day, not_before) if not_before else (key, day)) as c:
        row = await c.fetchone()
    return row[0] if row else None
