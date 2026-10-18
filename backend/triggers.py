"""
Routines that run when something happens, not only on a schedule.

A routine's `trigger` is one of:

  schedule      its days and time (inbox.py), as before
  bank_import   after transactions are imported (Finances → Import)
  budget        when a budget passes a share of its month, `percent` (default
                80). Once per budget per month. Checked hourly and after imports.
  calendar      when the next `days` days of the calendar change (default 2):
                something added, moved or removed. Checked every 30 minutes;
                at most once every 2 hours, so a busy morning of edits is one run.

The run is told what set it off, appended to the routine's instruction ("What
set this off: 14 new transactions imported into Wise…"), and goes to the
routine's agent like any other run.

What's been seen (the calendar as last checked, budgets already reported) is
kept in trigger_state, so a restart doesn't fire everything again.
"""
import json
import logging
from datetime import date, datetime, timedelta, timezone

log = logging.getLogger("atlas.triggers")

TRIGGERS = ("schedule", "bank_import", "budget", "calendar")
DEFAULTS = {"budget": {"percent": 80}, "calendar": {"days": 2}}
CALENDAR_EVERY = timedelta(minutes=30)
CALENDAR_GAP = timedelta(hours=2)
BUDGET_EVERY = timedelta(hours=1)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def clean_config(trigger: str, config) -> dict:
    """Check and fill in a trigger's settings. Raises ValueError."""
    if trigger not in TRIGGERS:
        raise ValueError("trigger is one of: " + ", ".join(TRIGGERS))
    config = dict(config or {})
    if trigger == "budget":
        try:
            pct = int(config.get("percent", 80))
        except (TypeError, ValueError):
            raise ValueError("percent is a whole number.")
        if not 10 <= pct <= 300:
            raise ValueError("percent is between 10 and 300.")
        return {"percent": pct}
    if trigger == "calendar":
        try:
            days = int(config.get("days", 2))
        except (TypeError, ValueError):
            raise ValueError("days is a whole number.")
        if not 1 <= days <= 14:
            raise ValueError("days is between 1 and 14.")
        return {"days": days}
    return {}


def describe(trigger: str, config: dict | None) -> str | None:
    """A non-schedule trigger in words; None for a schedule."""
    config = config or {}
    if trigger == "bank_import":
        return "After each bank import"
    if trigger == "budget":
        return f"When a budget passes {config.get('percent', 80)}%"
    if trigger == "calendar":
        d = config.get("days", 2)
        return "When today's calendar changes" if d == 1 else f"When the next {d} days' calendar changes"
    return None


# ── State ────────────────────────────────────────────────────────────────────

async def _get(db, key: str):
    async with db.execute("SELECT value FROM trigger_state WHERE key=?", (key,)) as c:
        row = await c.fetchone()
    return json.loads(row[0]) if row else None


async def _set(db, key: str, value) -> None:
    await db.execute("INSERT INTO trigger_state (key, value, updated_at) VALUES (?,?,?) "
                     "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                     (key, json.dumps(value), _now().isoformat()))
    await db.commit()


async def _routines(db, trigger: str) -> list[dict]:
    async with db.execute("SELECT * FROM routines WHERE enabled=1 AND trigger=?", (trigger,)) as c:
        rows = [dict(r) for r in await c.fetchall()]
    for r in rows:
        r["trigger_config"] = clean_config(trigger, json.loads(r.get("trigger_config") or "{}"))
    return rows


async def _start(routine_id: str, trigger: str, event: str) -> bool:
    import inbox
    item = await inbox.start_routine(routine_id, f"event:{trigger}", event=event)
    if item:
        log.info("Routine %s set off by %s", routine_id, trigger)
    return bool(item)


# ── Bank imports ─────────────────────────────────────────────────────────────

async def after_import(db, account: str, inserted: int, dates: list[str], categorised: int = 0) -> list[str]:
    """Called by Finances → Import once new transactions are in."""
    if inserted <= 0:
        return []
    routines = await _routines(db, "bank_import")
    started = []
    if routines:
        span = "" if not dates else f" dated {dates[0]}" if min(dates) == max(dates) else f" dated {min(dates)} to {max(dates)}"
        event = (f"{inserted} new transaction{'s' if inserted != 1 else ''} imported into {account}{span}"
                 + (f"; {categorised} were categorised automatically." if categorised else "."))
        for r in routines:
            if await _start(r["id"], "bank_import", event):
                started.append(r["id"])
    # New spending can tip a budget over.
    started += await check_budgets(db, force=True)
    return started


# ── Budgets ──────────────────────────────────────────────────────────────────

async def budget_levels(db, today: date | None = None) -> list[dict]:
    """This month's budgets: name, spent, amount, share (0.8 = 80%)."""
    import agent_tools
    import finance_insights
    today = today or date.today()
    async with db.execute("SELECT * FROM finances_budgets ORDER BY category") as c:
        budgets = [dict(r) for r in await c.fetchall()]
    if not budgets:
        return []
    txns = await agent_tools._transactions(db, today.replace(day=1).isoformat(), today.isoformat())
    status, _ = finance_insights.budget_status(budgets, txns, today=today, value=lambda t: t.get("eur") or 0)
    return [{"id": b["id"], "name": b["category"], "spent": b["spent"], "amount": float(b["amount"]),
             "share": b["spent"] / float(b["amount"])} for b in status if float(b.get("amount") or 0) > 0]


async def check_budgets(db, force: bool = False, today: date | None = None) -> list[str]:
    """Start budget routines for budgets that have passed their line this month."""
    routines = await _routines(db, "budget")
    if not routines:
        return []
    if not force:
        last = await _get(db, "budget:checked")
        if last and _now() - datetime.fromisoformat(last) < BUDGET_EVERY:
            return []
    await _set(db, "budget:checked", _now().isoformat())
    today = today or date.today()
    month = today.strftime("%Y-%m")
    levels = await budget_levels(db, today)
    started = []
    for r in routines:
        pct = r["trigger_config"]["percent"]
        key = f"budget:{r['id']}:{month}"
        told = set(await _get(db, key) or [])
        over = [b for b in levels if b["share"] * 100 >= pct and b["id"] not in told]
        if not over:
            continue
        event = "; ".join(f"the {b['name']} budget is at {round(b['share'] * 100)}% "
                          f"(€{b['spent']:.2f} of €{b['amount']:.2f})" for b in over)
        event = f"{event[0].upper()}{event[1:]}, past the {pct}% line, with {_days_left(today)} left in {today.strftime('%B')}."
        if await _start(r["id"], "budget", event):
            await _set(db, key, sorted(told | {b["id"] for b in over}))
            started.append(r["id"])
    return started


def _days_left(today: date) -> str:
    import calendar
    n = calendar.monthrange(today.year, today.month)[1] - today.day
    return f"{n} day{'s' if n != 1 else ''}"


# ── Calendar ─────────────────────────────────────────────────────────────────

def _event_key(e: dict) -> str:
    return f"{e.get('source', 'local')}:{e.get('id')}"


def _event_view(e: dict) -> dict:
    return {"title": e.get("title") or "(No title)", "date": e.get("date"), "start": str(e.get("start") or ""),
            "end": str(e.get("end") or "")}


async def calendar_snapshot(db, days: int, today: date | None = None) -> dict | None:
    """The next `days` days of events (Google and Atlas), keyed by id. None
    if Google Calendar couldn't be read just now."""
    import mcp_server
    today = today or date.today()
    end = today + timedelta(days=days - 1)
    google = await mcp_server._gcal_events(db, today, end, strict=True)
    if google is None:
        # Not connected is fine (local events only); a failed fetch isn't.
        if await mcp_server._gcal_token(db):
            return None
        google = []
    async with db.execute("SELECT id, title, date, start_h AS start, end_h AS end FROM local_events WHERE date BETWEEN ? AND ?",
                          (today.isoformat(), end.isoformat())) as c:
        local = [{**dict(r), "source": "local"} for r in await c.fetchall()]
    return {_event_key(e): _event_view(e) for e in [*google, *local]}


def describe_changes(before: dict, after: dict, today: date | None = None) -> list[str]:
    """What changed between two snapshots, in words. Events that simply
    dropped off the front (yesterday's) don't count."""
    today_s = (today or date.today()).isoformat()
    out = []
    for k, e in after.items():
        if k not in before:
            out.append(f"added “{e['title']}” on {e['date']}")
        elif (before[k]["date"], before[k]["start"], before[k]["end"]) != (e["date"], e["start"], e["end"]):
            out.append(f"moved “{e['title']}” to {e['date']}" + (f" {_hm(e['start'])}" if e["start"] else ""))
        elif before[k]["title"] != e["title"]:
            out.append(f"renamed “{before[k]['title']}” to “{e['title']}”")
    for k, e in before.items():
        if k not in after and (e.get("date") or "") >= today_s:
            out.append(f"removed “{e['title']}” on {e['date']}")
    return out


def _hm(v: str) -> str:
    if "T" in v:
        return v.split("T")[1][:5]
    try:
        h = float(v)
        return f"{int(h):02d}:{round(h % 1 * 60):02d}"
    except ValueError:
        return ""


async def check_calendar(db, force: bool = False, today: date | None = None) -> list[str]:
    routines = await _routines(db, "calendar")
    if not routines:
        return []
    started = []
    for r in routines:
        days = r["trigger_config"]["days"]
        key = f"calendar:{r['id']}"
        state = await _get(db, key) or {}
        if not force and state.get("checked") and _now() - datetime.fromisoformat(state["checked"]) < CALENDAR_EVERY:
            continue
        snap = await calendar_snapshot(db, days, today)
        if snap is None:
            continue   # try again next time
        before = state.get("events")
        changes = describe_changes(before, snap, today) if before is not None else []
        quiet = not state.get("fired") or _now() - datetime.fromisoformat(state["fired"]) >= CALENDAR_GAP
        fired = state.get("fired")
        if changes and quiet:
            shown = changes[:12] + ([f"and {len(changes) - 12} more"] if len(changes) > 12 else [])
            span = "today" if days == 1 else f"the next {days} days"
            if await _start(r["id"], "calendar", f"The calendar for {span} changed: " + "; ".join(shown) + "."):
                fired = _now().isoformat()
                started.append(r["id"])
            else:
                continue   # still running: keep the old view, so the change is seen next time
        elif changes:
            continue       # too soon after the last run: keep the old view until it's allowed
        # The first look only remembers; there's nothing to compare with yet.
        await _set(db, key, {"checked": _now().isoformat(), "fired": fired, "events": snap})
    return started


# ── From the scheduler ───────────────────────────────────────────────────────

async def tick() -> None:
    import inbox
    db = await inbox.connect()
    try:
        try:
            await check_budgets(db)
        except Exception:
            log.exception("Budget trigger check failed")
        try:
            await check_calendar(db)
        except Exception:
            log.exception("Calendar trigger check failed")
    finally:
        await db.close()
