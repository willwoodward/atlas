"""
The numbers behind the weekly review (the full-screen Sunday flow in the app).

A week is Monday to Sunday, keyed by the Monday's date like week_outcomes is.
`recap()` gathers what happened in it, section by section (goals, money, habits,
to-dos), and for each section writes a few plain *insights*: "you usually do this
habit six days a week, this week two", "this to-do has been open for 23 days".
Those are computed here, from the data, so they are always right and cost
nothing. `narrate()` then asks the model to say the same things warmly, in a
sentence or two per section, from the figures alone. It never sees merchant
names, and if it can't be reached the plain insights stand in for it.

Insight shape: {"kind": "good" | "warn" | "note", "text": str, "ref": {"type", "id"} | None}
where `ref` names the habit, to-do or goal the insight is about, so the app can
put the fix beside it.
"""
import hashlib
import json
import logging
import os
import statistics
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx

import finance_insights

log = logging.getLogger("atlas.weekly_review")

HISTORY_WEEKS = 4        # how many earlier weeks make up "usual"
STALE_DAYS = 14          # an open to-do this old is worth a second look
STREAK_MARKS = (7, 14, 21, 30, 50, 100, 200, 365)
SYMBOLS = {"EUR": "€", "GBP": "£", "USD": "$"}
DONE_PREFIX = "weekly_review:done:"
NARRATIVE_PREFIX = "weekly_review:narrative:"


def tz() -> ZoneInfo:
    return ZoneInfo(os.getenv("TZ") or "Europe/London")


def today_local() -> date:
    return datetime.now(tz()).date()


def parse_week(week: str) -> date:
    """The Monday a week key names. Raises ValueError for anything else."""
    d = date.fromisoformat(week)
    if d.weekday() != 0:
        raise ValueError("A week is keyed by its Monday")
    return d


def local_day(stamp: str | None) -> date | None:
    """The local calendar day of a stored timestamp. Rows hold either a bare
    date (written by the assistant) or an ISO instant in UTC (written by the app)."""
    if not stamp:
        return None
    s = stamp.strip()
    try:
        if len(s) <= 10:
            return date.fromisoformat(s)
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz()).date()


def money(amount: float, currency: str) -> str:
    sym = SYMBOLS.get(currency.upper())
    whole = f"{abs(amount):,.0f}"
    return f"{sym}{whole}" if sym else f"{whole} {currency.upper()}"


def plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def how_long(days: int) -> str:
    if days >= 14:
        return f"{days // 7} weeks"
    return plural(days, "day")


def insight(kind: str, text: str, ref: dict | None = None) -> dict:
    return {"kind": kind, "text": text, "ref": ref}


# ── Habits ────────────────────────────────────────────────────────────────────

async def habits_recap(db, monday: date, today: date) -> dict:
    sunday = monday + timedelta(days=6)
    last = min(sunday, today)                       # the days that have happened
    async with db.execute("SELECT id, name, color, created_at FROM habits ORDER BY created_at") as c:
        habits = [dict(r) for r in await c.fetchall()]
    done: dict[str, set] = {h["id"]: set() for h in habits}
    # All of it up to the week's end: streaks can run back months.
    async with db.execute("SELECT habit_id, date FROM habit_completions WHERE date <= ?", (sunday.isoformat(),)) as c:
        for r in await c.fetchall():
            done.setdefault(r["habit_id"], set()).add(r["date"])

    rows, tot_done, tot_possible, prev_done, prev_possible = [], 0, 0, 0, 0
    for h in habits:
        created = (h.get("created_at") or "")[:10]
        days = [monday + timedelta(days=i) for i in range(7)]
        possible = [d for d in days if d <= last and (not created or d.isoformat() >= created)]
        if not possible:
            continue                                # didn't exist yet
        mine = done[h["id"]]
        flags = [d.isoformat() in mine for d in days]
        n_done = sum(1 for d in possible if d.isoformat() in mine)

        rates = []
        for k in range(1, HISTORY_WEEKS + 1):
            wk = monday - timedelta(weeks=k)
            ds = [wk + timedelta(days=i) for i in range(7)]
            ds = [d for d in ds if not created or d.isoformat() >= created]
            if len(ds) >= 4:
                got = sum(1 for d in ds if d.isoformat() in mine)
                rates.append(got / len(ds))
                if k == 1:
                    prev_done += got
                    prev_possible += len(ds)
        usual = statistics.mean(rates) if rates else None

        # A streak counts back from the last day that has happened; today not
        # being ticked yet doesn't break it.
        cursor = last
        if cursor == today and cursor.isoformat() not in mine:
            cursor -= timedelta(days=1)
        streak = 0
        while cursor.isoformat() in mine and (not created or cursor.isoformat() >= created):
            streak += 1
            cursor -= timedelta(days=1)
        rows.append({
            "id": h["id"], "name": h["name"], "color": h["color"], "days": flags,
            "done": n_done, "possible": len(possible),
            "usual_days": round(usual * 7, 1) if usual is not None else None,
            "streak": streak,
        })
        tot_done += n_done
        tot_possible += len(possible)

    insights = []
    slipped = []
    for r in rows:
        usual = r["usual_days"]
        rate = r["done"] / r["possible"]
        if usual is not None and usual >= 3.5 and r["possible"] >= 3 and rate <= usual / 7 - 0.25:
            slipped.append((usual / 7 - rate, r))
        elif r["possible"] >= 5 and r["done"] == r["possible"]:
            insights.append(insight("good", f"“{r['name']}”: every day this week.", {"type": "habit", "id": r["id"]}))
        if r["streak"] in STREAK_MARKS:
            insights.append(insight("good", f"“{r['name']}” is on a {r['streak']}-day streak.", {"type": "habit", "id": r["id"]}))
    for _, r in sorted(slipped, key=lambda s: -s[0])[:4]:
        if r["done"] == 0:
            text = f"You didn't do “{r['name']}” at all; you usually manage about {round(r['usual_days'])} days a week."
        else:
            text = (f"“{r['name']}” is usually a {round(r['usual_days'])}-days-a-week habit for you, "
                    f"but you did it {r['done']} of {r['possible']} days.")
        insights.insert(0, insight("warn", text, {"type": "habit", "id": r["id"]}))

    if tot_possible and prev_possible:
        now_pct, then_pct = round(tot_done / tot_possible * 100), round(prev_done / prev_possible * 100)
        if abs(now_pct - then_pct) >= 5:
            word = "up" if now_pct > then_pct else "down"
            insights.append(insight("good" if now_pct > then_pct else "note",
                                    f"{now_pct}% of your habit check-ins done, {word} from {then_pct}% the week before."))
    return {
        "habits": rows, "done": tot_done, "possible": tot_possible,
        "rate": round(tot_done / tot_possible, 3) if tot_possible else None,
        "prev_rate": round(prev_done / prev_possible, 3) if prev_possible else None,
        "insights": insights,
    }


# ── To-dos ────────────────────────────────────────────────────────────────────

async def todos_recap(db, monday: date, today: date) -> dict:
    sunday = monday + timedelta(days=6)
    async with db.execute(
        "SELECT id, text, bucket, goal_id, done, created_at, completed_at FROM todos WHERE parent_id IS NULL OR parent_id = ''"
    ) as c:
        rows = [dict(r) for r in await c.fetchall()]

    def completed_between(r, start, end):
        d = local_day(r["completed_at"]) if r["done"] else None
        return d is not None and start <= d <= end

    finished = [r for r in rows if completed_between(r, monday, sunday)]
    prev_finished = [r for r in rows if completed_between(r, monday - timedelta(days=7), monday - timedelta(days=1))]
    open_rows = []
    for r in rows:
        if r["done"] or r["bucket"] not in ("today", "week"):
            continue
        made = local_day(r["created_at"])
        age = max((today - made).days, 0) if made else None
        open_rows.append({"id": r["id"], "text": r["text"], "bucket": r["bucket"], "goal_id": r["goal_id"], "age_days": age})
    open_rows.sort(key=lambda r: -(r["age_days"] or 0))
    someday = sum(1 for r in rows if not r["done"] and r["bucket"] == "someday")

    insights = []
    stale = [r for r in open_rows if r["age_days"] is not None and r["age_days"] >= STALE_DAYS]
    for r in stale[:3]:
        insights.append(insight(
            "warn", f"“{r['text']}” has been open for {how_long(r['age_days'])}. Do it this week, break it down, or let it go.",
            {"type": "todo", "id": r["id"]}))
    if len(stale) > 3:
        insights.append(insight("note", f"{len(stale) - 3} more to-dos are over {STALE_DAYS // 7} weeks old."))
    n, before = len(finished), len(prev_finished)
    if n and before and n != before:
        insights.append(insight("good" if n > before else "note",
                                f"You finished {plural(n, 'to-do')}, {'up' if n > before else 'down'} from {before} the week before."))
    elif n:
        insights.append(insight("good", f"You finished {plural(n, 'to-do')} this week."))
    elif open_rows:
        insights.append(insight("note", "No to-dos finished this week."))
    if len(open_rows) > 12:
        insights.append(insight("note", f"{len(open_rows)} to-dos are still open. That's a lot to carry into the week."))
    return {
        "finished": [{"id": r["id"], "text": r["text"], "goal_id": r["goal_id"]} for r in finished],
        "finished_count": n, "prev_finished_count": before,
        "open": open_rows, "open_count": len(open_rows), "stale_count": len(stale), "someday_count": someday,
        "insights": insights,
    }


# ── Goals ─────────────────────────────────────────────────────────────────────

async def goals_recap(db, monday: date, todos: dict) -> dict:
    quarter = f"q{((monday + timedelta(days=3)).month - 1) // 3 + 1}"
    async with db.execute("SELECT * FROM goals ORDER BY created_at") as c:
        goals = [dict(r) for r in await c.fetchall()]
    async with db.execute("SELECT goal_id, done, bucket FROM todos WHERE goal_id IS NOT NULL AND (parent_id IS NULL OR parent_id = '')") as c:
        linked = [dict(r) for r in await c.fetchall()]
    finished_by_goal: dict[str, list] = {}
    for t in todos["finished"]:
        if t["goal_id"]:
            finished_by_goal.setdefault(t["goal_id"], []).append(t["text"])

    rows, insights = [], []
    for g in goals:
        mine = [t for t in linked if t["goal_id"] == g["id"]]
        open_week = sum(1 for t in mine if not t["done"] and t["bucket"] in ("today", "week"))
        open_all = sum(1 for t in mine if not t["done"])
        finished = finished_by_goal.get(g["id"], [])
        rows.append({
            "id": g["id"], "title": g["title"], "color": g["color"], "tags": g.get("tags") or "",
            "focus": g.get(quarter) or "", "finished": finished, "finished_count": len(finished),
            "open_this_week": open_week, "open_count": open_all,
        })
        ref = {"type": "goal", "id": g["id"]}
        if finished:
            insights.append(insight("good", f"{plural(len(finished), 'to-do')} done towards “{g['title']}”.", ref))
        elif open_week:
            insights.append(insight("warn", f"Nothing moved on “{g['title']}” this week, and {open_week} {'to-do is' if open_week == 1 else 'to-dos are'} waiting.", ref))
        elif not mine:
            insights.append(insight("note", f"“{g['title']}” has no to-dos. What's the next small step?", ref))
        else:
            insights.append(insight("note", f"Nothing planned for “{g['title']}” this week.", ref))
    # Warnings first: they're the reason to look.
    order = {"warn": 0, "note": 1, "good": 2}
    insights.sort(key=lambda i: order[i["kind"]])
    return {"goals": rows, "quarter": quarter.upper(), "insights": insights[:6]}


# ── Money ─────────────────────────────────────────────────────────────────────

async def money_recap(db, monday: date, today: date, currency: str) -> dict:
    # Same conversion rules as the Finances page: each transaction at the rate on
    # its own date, balances at the latest, a missing rate reported, never 1:1.
    from routers.finances import _fx_for_ledger, _display_currency
    import fx
    display = _display_currency(currency)
    table = await _fx_for_ledger(db)
    missing: set[str] = set()

    def conv(amount, frm, on=None) -> float:
        frm = (frm or display).upper()
        try:
            return table.convert(float(amount or 0), frm, display, on)
        except fx.NoRate:
            missing.add(frm)
            return 0.0

    def value(t: dict) -> float:
        return conv(t.get("amount"), t.get("currency"), t.get("date"))

    sunday = monday + timedelta(days=6)
    end = min(sunday, today)
    async with db.execute("SELECT * FROM finances_transactions ORDER BY date DESC") as c:
        txns = [dict(r) for r in await c.fetchall()]

    def span(start: date, stop: date):
        a, b = start.isoformat(), stop.isoformat()
        return [t for t in txns if a <= (t["date"] or "") <= b]

    week = span(monday, sunday)
    spent = sum(value(t) for t in week if t["type"] == "expense")
    income = sum(value(t) for t in week if t["type"] == "income")

    # "Usual": the average over the weeks before, counting only weeks the ledger
    # reaches back to. Weeks with nothing in them count as zero if there is
    # older data, since a quiet week is information.
    first_date = min((t["date"] for t in txns if t["date"]), default=None)
    usual_weeks = []
    for k in range(1, HISTORY_WEEKS + 1):
        wk = monday - timedelta(weeks=k)
        if first_date and wk + timedelta(days=6) >= date.fromisoformat(first_date[:10]):
            usual_weeks.append(span(wk, wk + timedelta(days=6)))
    usual_total = statistics.mean([sum(value(t) for t in w if t["type"] == "expense") for w in usual_weeks]) if usual_weeks else None

    def by_category(rows):
        out: dict[str, float] = {}
        for t in rows:
            if t["type"] != "expense":
                continue
            key = (t.get("category") or "").strip() or "Uncategorised"
            out[key] = out.get(key, 0) + value(t)
        return out

    this_cats = by_category(week)
    usual_cats: dict[str, float] = {}
    for w in usual_weeks:
        for k, v in by_category(w).items():
            usual_cats[k] = usual_cats.get(k, 0) + v / len(usual_weeks)
    categories = [{"category": k, "amount": round(v, 2),
                   "usual": round(usual_cats[k], 2) if usual_weeks and k in usual_cats else (0.0 if usual_weeks else None)}
                  for k, v in sorted(this_cats.items(), key=lambda kv: -kv[1])][:8]

    uncategorised = [{"id": t["id"], "merchant": t["merchant"], "date": t["date"], "type": t["type"], "amount": round(value(t), 2)}
                     for t in week if not (t.get("category") or "").strip()]
    biggest = [{"id": t["id"], "merchant": t["merchant"], "date": t["date"], "category": t.get("category") or "", "amount": round(value(t), 2)}
               for t in sorted((t for t in week if t["type"] == "expense"), key=lambda t: -value(t))[:3]]

    async with db.execute("SELECT * FROM finances_budgets") as c:
        budgets = [dict(r) for r in await c.fetchall()]
    for b in budgets:
        b["amount"] = round(conv(b["amount"], b.get("currency")), 2)
    # A week can straddle two months; each is checked against its own budgets.
    months = list(dict.fromkeys([f"{monday.year}-{monday.month:02d}", f"{end.year}-{end.month:02d}"]))
    budget_rows = []
    for month in months:
        status, _ = finance_insights.budget_status(budgets, txns, month, today=end, value=value)
        budget_rows += [{"name": b["category"], "month": month, "spent": b["spent"], "limit": b["amount"], "pct": b["pct"],
                         "pace": b["pace"], "over": b["over"]} for b in status if b["amount"] > 0]

    # Net worth comes from the hourly snapshots, which are kept in EUR.
    async def snapshot_on_or_before(day: date):
        async with db.execute("SELECT value FROM daily_snapshots WHERE key = 'net_worth' AND date <= ? ORDER BY date DESC LIMIT 1",
                              (day.isoformat(),)) as c:
            row = await c.fetchone()
        return row["value"] if row else None
    nw_after, nw_before = await snapshot_on_or_before(end), await snapshot_on_or_before(monday - timedelta(days=1))
    net_worth = None
    if nw_after is not None and nw_before is not None:
        net_worth = {"change": round(conv(nw_after - nw_before, "EUR"), 2), "now": round(conv(nw_after, "EUR"), 2)}

    last_txn = txns[0]["date"][:10] if txns and txns[0]["date"] else None
    behind = (end - date.fromisoformat(last_txn)).days if last_txn else None
    stale = last_txn is None or (behind is not None and behind >= 3) or not week

    insights = []
    if stale:
        if last_txn:
            insights.append(insight("note", f"Your latest transaction is from {date.fromisoformat(last_txn).strftime('%-d %b')}. "
                                            "Import a fresh statement to see the whole week.", {"type": "import"}))
        else:
            insights.append(insight("note", "No transactions yet. Import a statement to see how the week went.", {"type": "import"}))
    if usual_total is not None and week:
        diff = spent - usual_total
        if abs(diff) >= max(15, usual_total * 0.15):
            insights.append(insight("warn" if diff > 0 else "good",
                                    f"You spent {money(spent, display)}, {money(abs(diff), display)} "
                                    f"{'more' if diff > 0 else 'less'} than your usual {money(usual_total, display)}."))
    spikes = [c for c in categories if c["usual"] and c["category"] != "Uncategorised"
              and c["amount"] >= c["usual"] * 1.5 and c["amount"] - c["usual"] >= 20]
    for c in spikes[:2]:
        insights.append(insight("warn", f"{c['category']} was {money(c['amount'], display)}, well above its usual {money(c['usual'], display)}."))
    for b in budget_rows:
        month_name = date(int(b["month"][:4]), int(b["month"][5:]), 1).strftime("%B")
        if b["over"]:
            insights.append(insight("warn", f"The {b['name']} budget is over for {month_name}: {money(b['spent'], display)} of {money(b['limit'], display)}.", {"type": "budget"}))
        elif b["pace"] > 1.15 and b["pct"] >= 60 and b["month"] == months[-1]:
            insights.append(insight("note", f"{b['name']} is running ahead: {b['pct']}% of the budget used, faster than the month is passing.", {"type": "budget"}))
    if uncategorised:
        insights.append(insight("note", f"{plural(len(uncategorised), 'transaction')} still need a category.", {"type": "categorise"}))
    if net_worth and abs(net_worth["change"]) >= 1:
        up = net_worth["change"] > 0
        insights.append(insight("good" if up else "note", f"Net worth {'rose' if up else 'fell'} by {money(abs(net_worth['change']), display)} this week."))

    return {
        "currency": display, "spent": round(spent, 2), "income": round(income, 2), "count": len(week),
        "usual_spent": round(usual_total, 2) if usual_total is not None else None,
        "categories": categories, "uncategorised": uncategorised[:15], "uncategorised_count": len(uncategorised),
        "biggest": biggest, "budgets": budget_rows, "net_worth": net_worth,
        "last_transaction": last_txn, "stale": stale, "missing_rates": sorted(missing),
        "insights": insights,
    }


# ── The whole recap ───────────────────────────────────────────────────────────

async def recap(db, week: str, currency: str = "EUR", today: date | None = None) -> dict:
    monday = parse_week(week)
    today = today or today_local()
    habits = await habits_recap(db, monday, today)
    todos = await todos_recap(db, monday, today)
    goals = await goals_recap(db, monday, todos)
    money_part = await money_recap(db, monday, today, currency)
    async with db.execute("SELECT value FROM app_settings WHERE key = ?", (DONE_PREFIX + week,)) as c:
        row = await c.fetchone()
    return {
        "week": week, "ends": (monday + timedelta(days=6)).isoformat(), "partial": today < monday + timedelta(days=6),
        "completed_at": row["value"] if row else None,
        "goals": goals, "money": money_part, "habits": habits, "todos": todos,
    }


async def completed_weeks(db) -> list[str]:
    async with db.execute("SELECT key FROM app_settings WHERE key LIKE ? ORDER BY key DESC", (DONE_PREFIX + "%",)) as c:
        return [r["key"][len(DONE_PREFIX):] for r in await c.fetchall()]


async def set_completed(db, week: str, done: bool) -> None:
    if done:
        await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
                         (DONE_PREFIX + week, datetime.now(timezone.utc).isoformat()))
    else:
        await db.execute("DELETE FROM app_settings WHERE key = ?", (DONE_PREFIX + week,))
    await db.commit()


# ── Commentary from the model ─────────────────────────────────────────────────

SECTIONS = ("goals", "money", "habits", "todos")

INSTRUCTIONS = """You write the short commentary for one person's weekly review of their own life: goals, \
money, habits and to-dos. You are Atlas, their assistant, speaking to them directly in the second person, \
like a thoughtful friend who has read the numbers: warm, specific, never gushing, never scolding.

You are given the week's figures and a list of observations already worked out. Use only those; never \
invent a number, a habit, a to-do or a reason. Quote figures exactly as given, with the currency symbol \
as written. Each field is one or two short sentences. Lead with what matters most: a habit that slipped \
or a to-do that has sat for weeks matters more than a streak. Name the specific habit or to-do. If a \
section has nothing worth saying, return an empty string for it. If the week was quiet or the data is \
thin, say so plainly instead of padding.

headline: one line, under 90 characters, that sums up the week.
plan: one sentence nudging what to focus on next week, drawn from what was observed."""

SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {k: {"type": "string"} for k in ("headline", *SECTIONS, "plan")},
    "required": ["headline", *SECTIONS, "plan"],
}


def model_id() -> str:
    return os.getenv("WEEKLY_REVIEW_MODEL") or os.getenv("AGENT_MODEL_ID") or "gpt-6-luna"


def configured() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


def facts_for(data: dict, goal_hours: list[dict]) -> dict:
    """What the model is told. Aggregates and the user's own habit, goal and
    to-do wording; no merchant names, and no account details."""
    g, m, h, t = data["goals"], data["money"], data["habits"], data["todos"]
    return {
        "week_starting": data["week"], "week_is_unfinished": data["partial"],
        "goals": {"quarter": g["quarter"], "observations": [i["text"] for i in g["insights"]],
                  "hours_on_goals": goal_hours,
                  "per_goal": [{"title": r["title"], "todos_done": r["finished_count"], "todos_waiting": r["open_this_week"]} for r in g["goals"]]},
        "money": {"currency": m["currency"], "spent": m["spent"], "income": m["income"], "usual_weekly_spend": m["usual_spent"],
                  "transactions": m["count"], "top_categories": [{"category": c["category"], "amount": c["amount"], "usual": c["usual"]} for c in m["categories"][:5]],
                  "budgets_over": [b["name"] for b in m["budgets"] if b["over"]], "uncategorised": m["uncategorised_count"],
                  "net_worth_change": m["net_worth"]["change"] if m["net_worth"] else None, "observations": [i["text"] for i in m["insights"]]},
        "habits": {"checkins_done": h["done"], "checkins_possible": h["possible"], "previous_week_rate": h["prev_rate"],
                   "per_habit": [{"name": r["name"], "days_done": r["done"], "days_possible": r["possible"], "usual_days_per_week": r["usual_days"], "streak": r["streak"]} for r in h["habits"]],
                   "observations": [i["text"] for i in h["insights"]]},
        "todos": {"finished": t["finished_count"], "finished_previous_week": t["prev_finished_count"], "still_open": t["open_count"],
                  "open_over_two_weeks": t["stale_count"], "finished_examples": [x["text"] for x in t["finished"][:6]],
                  "oldest_open": [{"text": r["text"], "age_days": r["age_days"]} for r in t["open"][:3]],
                  "observations": [i["text"] for i in t["insights"]]},
    }


def plain_narrative(data: dict) -> dict:
    """The same observations without the model: first one of each kind, in order."""
    def lead(section):
        items = data[section]["insights"]
        return " ".join(i["text"] for i in items[:2])
    h, t, m = data["habits"], data["todos"], data["money"]
    bits = []
    if h["possible"]:
        bits.append(f"{h['done']} of {h['possible']} habit check-ins")
    bits.append(f"{plural(t['finished_count'], 'to-do')} finished")
    if m["count"]:
        bits.append(f"{money(m['spent'], m['currency'])} spent")
    return {"headline": ", ".join(bits).capitalize() + ".", **{s: lead(s) for s in SECTIONS},
            "plan": "", "source": "plain"}


def _output_text(body: dict) -> str:
    if isinstance(body.get("output_text"), str):
        return body["output_text"]
    parts = []
    for item in body.get("output", []):
        if item.get("type") == "message":
            for c in item.get("content", []):
                if c.get("type") == "output_text":
                    parts.append(c.get("text", ""))
    return "".join(parts)


async def _call_model(facts: dict) -> dict:
    base = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    payload = {
        "model": model_id(),
        "instructions": INSTRUCTIONS,
        "input": json.dumps(facts, ensure_ascii=False),
        "text": {"format": {"type": "json_schema", "name": "weekly_review", "schema": SCHEMA, "strict": True}},
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(f"{base}/responses", json=payload,
                              headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"})
    if r.status_code >= 400:
        raise RuntimeError(f"The model request failed ({r.status_code}): {r.text[:200]}")
    out = json.loads(_output_text(r.json()))
    return {k: str(out.get(k) or "").strip() for k in ("headline", *SECTIONS, "plan")}


async def narrate(db, data: dict, goal_hours: list[dict], refresh: bool = False) -> dict:
    """Commentary for the week, kept until the figures change. Falls back to the
    plain observations when the model isn't configured or can't be reached."""
    facts = facts_for(data, goal_hours)
    digest = hashlib.sha256(json.dumps(facts, sort_keys=True).encode()).hexdigest()[:16]
    key = NARRATIVE_PREFIX + data["week"]
    if not refresh:
        async with db.execute("SELECT value FROM app_settings WHERE key = ?", (key,)) as c:
            row = await c.fetchone()
        if row:
            try:
                kept = json.loads(row["value"])
                if kept.get("digest") == digest:
                    return kept["narrative"]
            except ValueError:
                pass
    if not configured():
        return plain_narrative(data)
    try:
        narrative = {**await _call_model(facts), "source": "model"}
    except Exception as exc:   # noqa: BLE001 - any failure here falls back to the plain text
        log.warning("Weekly review commentary failed: %s", exc)
        return plain_narrative(data)
    await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
                     (key, json.dumps({"digest": digest, "narrative": narrative})))
    await db.commit()
    return narrative
