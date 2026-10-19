"""
Tools whose main job is to draw something in the chat (see ChatCards.jsx):
to-dos with checkboxes, habit streaks, trends, lift progress, a note,
and a set of choices to tap. Plus `change_card`, the before → after card the
editing tools attach to what they return.

Like agent_tools, a result carries `card` for the chat and the same facts in
plain fields for the model.
"""
import re
from collections import defaultdict
from datetime import date, datetime, timedelta

from mcp.types import Tool

import agent_tools
from agent_tools import _transactions, _cat, period_range

BUCKET_LABEL = {"today": "Today", "week": "This week", "someday": "Someday"}


def change_card(title: str, rows: list[tuple[str, object, object]], show: dict | None = None) -> dict:
    """Before → after for an edit. Rows whose value didn't change are left out."""
    def fmt(v):
        if v is None or v == "":
            return "—"
        return str(v)
    out = [{"label": label, "before": fmt(b), "after": fmt(a)} for label, b, a in rows if fmt(b) != fmt(a)]
    return {"type": "change", "title": title, "rows": out, **({"show": show} if show else {})}


def hm(h) -> str:
    if h is None:
        return ""
    h = float(h)
    return f"{int(h)}:{round((h - int(h)) * 60):02d}"


def note_card(note_id: str, body: str, title_prefix: str = "") -> dict:
    lines = (body or "").splitlines()
    idx = next((i for i, l in enumerate(lines) if l.strip()), None)
    first = lines[idx].lstrip("# ").strip()[:80] if idx is not None else "Untitled"
    rest = "\n".join(lines[idx + 1:]) if idx is not None else ""
    return {"type": "note", "id": note_id, "title": f"{title_prefix}{first}", "snippet": rest.strip()[:700]}


# ── Goal tags (mirrors frontend/src/lib/goalTime.js) ─────────────────────────

def parse_tags(tags: str) -> list[str]:
    return [t.strip().lower() for t in (tags or "").split(",") if t.strip()]


def matches_tag(title: str, tag: str) -> bool:
    t = (title or "").lower()
    if "*" in tag:
        if not tag.replace("*", ""):
            return False
        body = ".*".join(re.escape(p) for p in tag.split("*"))
        start = "" if tag.startswith("*") else r"(?:^|[^a-z0-9])"
        end = "" if tag.endswith("*") else r"(?:$|[^a-z0-9])"
        return re.search(start + body + end, t) is not None
    i = t.find(tag)
    while i != -1:
        before = t[i - 1] if i > 0 else ""
        after = t[i + len(tag)] if i + len(tag) < len(t) else ""
        if not re.match(r"[a-z0-9]", before or " ") and not re.match(r"[a-z0-9]", after or " "):
            return True
        i = t.find(tag, i + 1)
    return False


# ── Tools ────────────────────────────────────────────────────────────────────

TOOLS = [
    Tool(name="show_todos",
         description="Show the user's to-dos as a checklist they can tick in the chat. Use when they ask what's on their list.",
         inputSchema={"type": "object", "properties": {
             "bucket": {"type": "string", "enum": ["today", "week", "someday", "open"], "description": "open (default) = today and this week"}},
             "required": []}),
    Tool(name="habit_streaks",
         description="Show habits with a dot per day (done or not) and current streaks.",
         inputSchema={"type": "object", "properties": {"days": {"type": "integer", "description": "7 (default) to 35"}}, "required": []}),
    Tool(name="spending_trend",
         description="Chart spending (or income) per week or month, optionally for one category. Use for 'how has my X spending changed'.",
         inputSchema={"type": "object", "properties": {
             "by": {"type": "string", "enum": ["week", "month"], "description": "default month"},
             "count": {"type": "integer", "description": "How many weeks/months back, including the current one (default 8 weeks / 6 months)"},
             "kind": {"type": "string", "enum": ["spending", "income"]},
             "category": {"type": "string"}}, "required": []}),
    Tool(name="net_worth_trend",
         description="Chart net worth month by month, estimated by walking today's account balances back through the imported transactions. Accurate only as far as transactions are imported for every account.",
         inputSchema={"type": "object", "properties": {"months": {"type": "integer", "description": "default 6, max 24"}}, "required": []}),
    Tool(name="history_chart",
         description="Chart how something has changed over time: net worth, savings in pots, an account's balance, open to-dos "
                     "(daily values Atlas records, estimated before recording began and marked so), income vs spending by month, "
                     "or habit consistency week by week. Prefer this over net_worth_trend for anything over time.",
         inputSchema={"type": "object", "properties": {
             "chart": {"type": "string", "enum": ["balances", "cashflow", "habits"],
                       "description": "balances: one or more series as lines; cashflow: income vs spending per month; habits: weekly consistency"},
             "series": {"type": "array", "items": {"type": "string"},
                        "description": "balances only: net_worth (default), saved, open_todos, or account:<name> for one account's balance (e.g. account:Wise)"},
             "range": {"type": "string", "enum": ["30d", "90d", "1y", "all"], "description": "balances only, default 90d"},
             "months": {"type": "integer", "description": "cashflow only, default 6"},
             "weeks": {"type": "integer", "description": "habits only, default 8"}},
             "required": ["chart"]}),
    Tool(name="goal_time",
         description="Chart hours per week spent on each goal (calendar events matched by the goal's tags), for recent weeks.",
         inputSchema={"type": "object", "properties": {"weeks": {"type": "integer", "description": "default 8, max 16"}}, "required": []}),
    # From the user's own gym log in Atlas. Never Strava: its terms forbid
    # using its data in any AI application (see the Strava client module).
    Tool(name="lift_progress",
         description="Chart the weight the user has logged in their Atlas gym log for one lift over time.",
         inputSchema={"type": "object", "properties": {"exercise": {"type": "string", "description": "Lift name, e.g. squat"}}, "required": ["exercise"]}),
    Tool(name="show_note",
         description="Show a preview of a quick note in the chat, with a button to open it.",
         inputSchema={"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}),
    Tool(name="offer_choices",
         description="Give the user a few options to pick from with a tap (e.g. three time slots, or which of two plans). Ask the question in your reply too; their pick comes back as their next message, so stop after offering.",
         inputSchema={"type": "object", "properties": {
             "question": {"type": "string"},
             "options": {"type": "array", "items": {"type": "string"}, "description": "2 to 6 short options"}},
             "required": ["question", "options"]}),
]
NAMES = {t.name for t in TOOLS}


async def dispatch(name: str, args: dict, db, gcal_events=None):
    today = date.today()

    if name == "show_todos":
        bucket = args.get("bucket") or "open"
        buckets = ["today", "week"] if bucket == "open" else [bucket]
        marks = ",".join("?" * len(buckets))
        async with db.execute(f"SELECT id, text, bucket, done, parent_id FROM todos WHERE bucket IN ({marks}) "
                              "ORDER BY CASE bucket WHEN 'today' THEN 0 WHEN 'week' THEN 1 ELSE 2 END, sort_order", buckets) as c:
            rows = [dict(r) for r in await c.fetchall()]
        rows = [{**r, "done": bool(r["done"])} for r in rows]
        open_n = sum(1 for r in rows if not r["done"])
        title = " & ".join(BUCKET_LABEL[b] for b in buckets)
        return {"todos": rows, "open": open_n,
                "card": {"type": "todos", "title": f"To-dos · {title}", "rows": rows[:30]},
                "show": {"kind": "page", "page": "todos"}}

    if name == "habit_streaks":
        n = max(7, min(int(args.get("days") or 7), 35))
        days = [(today - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]
        async with db.execute("SELECT id, name, color FROM habits ORDER BY created_at") as c:
            habits = [dict(r) for r in await c.fetchall()]
        async with db.execute("SELECT habit_id, date FROM habit_completions WHERE date >= ?",
                              ((today - timedelta(days=400)).isoformat(),)) as c:
            done = defaultdict(set)
            for r in await c.fetchall():
                done[r["habit_id"]].add(r["date"])
        rows = []
        for h in habits:
            mine = done[h["id"]]
            streak, d = 0, today if today.isoformat() in mine else today - timedelta(days=1)
            while d.isoformat() in mine:
                streak += 1
                d -= timedelta(days=1)
            rows.append({"id": h["id"], "name": h["name"], "color": h["color"], "done": [x in mine for x in days],
                         "streak": streak, "rate": round(sum(x in mine for x in days) / n * 100)})
        return {"days": days, "habits": [{k: r[k] for k in ("name", "streak", "rate")} for r in rows],
                "card": {"type": "habits", "title": f"Habits · last {n} days", "days": days, "rows": rows},
                "show": {"kind": "page", "page": "habits"}}

    if name == "spending_trend":
        by = args.get("by") or "month"
        kind = args.get("kind") or "spending"
        want = "income" if kind == "income" else "expense"
        count = max(2, min(int(args.get("count") or (8 if by == "week" else 6)), 26 if by == "week" else 24))
        if by == "week":
            monday = today - timedelta(days=today.weekday())
            starts = [monday - timedelta(weeks=i) for i in range(count - 1, -1, -1)]
            key = lambda d: (d - timedelta(days=d.weekday())).isoformat()
            labels = [(s.isoformat(), s.strftime("%-d %b")) for s in starts]
        else:
            starts, y, m = [], today.year, today.month
            for _ in range(count):
                starts.append(date(y, m, 1))
                y, m = (y - 1, 12) if m == 1 else (y, m - 1)
            starts.reverse()
            key = lambda d: d.replace(day=1).isoformat()
            labels = [(s.isoformat(), s.strftime("%b")) for s in starts]
        txns = await _transactions(db, starts[0].isoformat(), today.isoformat())
        cat = (args.get("category") or "").strip().lower()
        sums = defaultdict(float)
        for t in txns:
            if t["type"] != want or t.get("eur") is None or (cat and _cat(t).lower() != cat):
                continue
            sums[key(date.fromisoformat(t["date"]))] += t["eur"]
        points = [{"label": lab, "value": round(sums.get(k, 0), 2), "current": i == len(labels) - 1}
                  for i, (k, lab) in enumerate(labels)]
        what = f"{'Income' if kind == 'income' else 'Spending'}{' on ' + args['category'] if args.get('category') else ''}"
        return {"currency": "EUR", "by": by, "points": points,
                "card": {"type": "trend", "title": f"{what} · by {by}", "unit": "money", "currency": "EUR", "points": points,
                         "note": "This " + by + " so far" if points else None},
                "show": {"kind": "finances", "category": args.get("category"), "type": want}}

    if name == "net_worth_trend":
        import fx
        months = max(2, min(int(args.get("months") or 6), 24))
        async with db.execute("SELECT id, type, balance, currency FROM finances_accounts") as c:
            accounts = [dict(r) for r in await c.fetchall()]
        if not accounts:
            return {"error": "No accounts yet — add them on the Finances page."}
        async with db.execute("SELECT account_id, type, amount, date FROM finances_transactions WHERE account_id IS NOT NULL") as c:
            txns = [dict(r) for r in await c.fetchall()]
        table = await fx.ensure(db, {(a["currency"] or "EUR").upper() for a in accounts})
        # Today, then the end of each month before it.
        ends, first_of = [today], today.replace(day=1)
        for _ in range(months - 1):
            end = first_of - timedelta(days=1)
            ends.append(end)
            first_of = end.replace(day=1)
        import snapshots
        points, recorded = [], 0
        for end in reversed(ends):
            # A recorded value (snapshots.py) from that month beats an estimate.
            kept = await snapshots.value_on_or_before(db, "net_worth", end.isoformat(), end.replace(day=1).isoformat())
            if kept is not None:
                recorded += 1
                points.append({"label": "Now" if end == today else end.strftime("%b"), "value": round(kept, 2),
                               "current": end == today, "recorded": True})
                continue
            total = 0.0
            for a in accounts:
                after = sum((t["amount"] if t["type"] == "income" else -t["amount"])
                            for t in txns if t["account_id"] == a["id"] and t["date"] > end.isoformat())
                bal = float(a["balance"] or 0)
                at = bal - after if a["type"] != "credit" else bal + after
                try:
                    v = table.convert(at, (a["currency"] or "EUR").upper(), "EUR")
                except fx.NoRate:
                    continue
                total += -v if a["type"] == "credit" else v
            points.append({"label": "Now" if end == today else end.strftime("%b"), "value": round(total, 2), "current": end == today})
        accounts_without = sum(1 for a in accounts if not any(t["account_id"] == a["id"] for t in txns))
        note = ("Recorded" if recorded == len(points) else
                "Estimated from your balances and imported transactions" + (f" ({recorded} month{'s' if recorded != 1 else ''} recorded)" if recorded else ""))
        if accounts_without and recorded < len(points):
            note += f"; {accounts_without} account{'s' if accounts_without != 1 else ''} without transactions held flat"
        return {"currency": "EUR", "points": points, "note": note,
                "card": {"type": "trend", "title": "Net worth · month end", "unit": "money", "currency": "EUR", "line": True,
                         "points": points, "note": note},
                "show": {"kind": "page", "page": "finances"}}

    if name == "history_chart":
        import history
        chart = args.get("chart") or "balances"
        if chart == "cashflow":
            data = await history.cashflow(db, int(args.get("months") or 6))
            show = {"kind": "page", "page": "finances"}
            return {**data, "card": {"type": "history", "chart": "cashflow", "title": "Income and spending", **data}, "show": show}
        if chart == "habits":
            data = await history.habits(db, int(args.get("weeks") or 8))
            if not data["habits"]:
                return {"error": "No habits yet."}
            return {"weeks": data["weeks"], "habits": [{"name": h["name"], "values": h["values"]} for h in data["habits"]],
                    "card": {"type": "history", "chart": "habits", "title": "Habit consistency · by week", **data},
                    "show": {"kind": "page", "page": "habits"}}
        keys = [k for k in (args.get("series") or ["net_worth"]) if isinstance(k, str)][:6]
        rng = args.get("range") if args.get("range") in history.RANGES else "90d"
        series = [x for x in [await history.series(db, k, rng) for k in keys] if x]
        if not series:
            return {"error": "Nothing to chart for those series."}
        summary = [{"key": x["key"], "label": x["label"], "currency": x.get("currency"),
                    "first": x["points"][0] if x["points"] else None, "last": x["points"][-1] if x["points"] else None,
                    "recorded_since": x["recorded_since"]} for x in series]
        page = "todos" if keys == ["open_todos"] else "finances"
        title = series[0]["label"] if len(series) == 1 else " · ".join(x["label"] for x in series)
        return {"series": summary,
                "card": {"type": "history", "chart": "lines", "title": title, "range": rng, "series": series},
                "show": {"kind": "page", "page": page}}

    if name == "goal_time":
        weeks = max(2, min(int(args.get("weeks") or 8), 16))
        async with db.execute("SELECT id, title, color, tags FROM goals ORDER BY created_at") as c:
            goals = [dict(r) for r in await c.fetchall()]
        tagged = [g for g in goals if parse_tags(g.get("tags") or "")]
        if not tagged:
            return {"error": "No goals have calendar tags yet. Add tags to a goal (e.g. 'gym, run') so its events count."}
        monday = today - timedelta(days=today.weekday())
        first = monday - timedelta(weeks=weeks - 1)
        events = await agent_tools._all_events(db, first, monday + timedelta(days=6), gcal_events)
        per = defaultdict(lambda: defaultdict(float))
        now_h = datetime.now().hour + datetime.now().minute / 60
        for e in events:
            if e.get("all_day") or e.get("start_h") is None or e.get("end_h") is None:
                continue
            g = next((g for g in tagged if any(matches_tag(e["title"], t) for t in parse_tags(g["tags"]))), None)
            if not g:
                continue
            d = date.fromisoformat(e["date"])
            dur = max(0.0, e["end_h"] - e["start_h"])
            if d > today:
                continue
            if d == today:
                dur = min(max(now_h - e["start_h"], 0), dur)
            per[(d - timedelta(days=d.weekday())).isoformat()][g["id"]] += dur
        points = []
        for i in range(weeks):
            wk = first + timedelta(weeks=i)
            segs = [{"label": g["title"], "value": round(per[wk.isoformat()].get(g["id"], 0), 2), "color": g["color"]} for g in tagged]
            points.append({"label": wk.strftime("%-d %b"), "value": round(sum(s["value"] for s in segs), 2),
                           "segments": segs, "current": i == weeks - 1})
        return {"weeks": points,
                "card": {"type": "trend", "title": "Goal time · hours per week", "unit": "hours", "points": points,
                         "legend": [{"label": g["title"], "color": g["color"]} for g in tagged]},
                "show": {"kind": "page", "page": "goals"}}

    if name == "lift_progress":
        q = (args.get("exercise") or "").strip().lower()
        async with db.execute("SELECT id, name, unit FROM gym_exercises") as c:
            exercises = [dict(r) for r in await c.fetchall()]
        ex = next((e for e in exercises if e["name"].lower() == q), None) or next((e for e in exercises if q in e["name"].lower()), None)
        if not ex:
            return {"error": f"No exercise matching “{args.get('exercise')}”", "exercises": [e["name"] for e in exercises][:40]}
        async with db.execute("SELECT date, weight, sets, reps FROM gym_lift_log WHERE exercise_id=? AND weight IS NOT NULL ORDER BY date",
                              (ex["id"],)) as c:
            log = [dict(r) for r in await c.fetchall()]
        if not log:
            return {"error": f"Nothing logged for {ex['name']} yet."}
        log = log[-20:]
        points = [{"label": date.fromisoformat(r["date"]).strftime("%-d %b"), "value": r["weight"], "current": i == len(log) - 1}
                  for i, r in enumerate(log)]
        return {"exercise": ex["name"], "unit": ex["unit"], "log": log,
                "card": {"type": "trend", "title": f"{ex['name']} · weight", "unit": ex["unit"], "line": True, "points": points},
                "show": {"kind": "page", "page": "fitness"}}

    if name == "show_note":
        async with db.execute("SELECT id, body FROM notes WHERE id=?", (args.get("id"),)) as c:
            row = await c.fetchone()
        if not row:
            return {"error": "No note with that id"}
        return {"id": row["id"], "body": row["body"][:2000], "card": note_card(row["id"], row["body"]),
                "show": {"kind": "note", "id": row["id"]}}

    if name == "offer_choices":
        options = [str(o).strip()[:80] for o in (args.get("options") or []) if str(o).strip()][:6]
        if len(options) < 2:
            return {"error": "Give at least two options"}
        return {"ok": True, "note": "Shown as buttons. Stop here; their pick arrives as their next message.",
                "card": {"type": "choices", "question": (args.get("question") or "").strip()[:200], "options": options}}

    return None
