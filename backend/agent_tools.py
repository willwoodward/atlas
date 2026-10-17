"""
The assistant's richer tools: finance investigation and tidying, calendar
search and free time, a few missing edits — and `show`, which opens a view in
the app.

Registered alongside the core tools in mcp_server.py. Two conventions:

- Every tool that changes something records it in the action log
  (agent_actions.py) and returns `undo_id`, so the chat can offer Undo.
- A result may carry `card` (drawn in the chat: a breakdown, a day, a list)
  and `show` (what to open to see it). Cards hold only what's needed to draw
  them, since the model reads the same result.
"""
import json
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from mcp.types import Tool

import agent_actions as actions
from agent_actions import delete_rows, restore_rows, snapshot


def change_card(*a, **kw):
    from agent_cards import change_card as cc   # lazy: agent_cards imports this module
    return cc(*a, **kw)

UNCATEGORISED = "Uncategorised"
CARD_ROWS = 10          # rows drawn in a card; the rest fold into "Other"
PERIODS = ["30d", "month", "last-month", "3m", "year", "all"]
HABIT_COLORS = {"morning": "#6f8168", "daytime": "#b08a3e", "evening": "#9a6d84"}


# ── Periods and money ────────────────────────────────────────────────────────

def period_range(period: str | None, start: str | None = None, end: str | None = None,
                 today: date | None = None) -> tuple[str | None, str | None, str]:
    """(from, to, label) for a named period or explicit dates — the same
    windows as the app's Finances page."""
    today = today or date.today()
    if start or end:
        return start, end, f"{start or 'start'} – {end or 'today'}"
    y, m = today.year, today.month
    first = date(y, m, 1)
    if period == "month":
        nxt = date(y + (m == 12), m % 12 + 1, 1)
        return first.isoformat(), (nxt - timedelta(days=1)).isoformat(), today.strftime("%B %Y")
    if period == "last-month":
        last_end = first - timedelta(days=1)
        return last_end.replace(day=1).isoformat(), last_end.isoformat(), last_end.strftime("%B %Y")
    if period == "3m":
        mm, yy = m - 2, y
        if mm < 1:
            mm, yy = mm + 12, y - 1
        nxt = date(y + (m == 12), m % 12 + 1, 1)
        return date(yy, mm, 1).isoformat(), (nxt - timedelta(days=1)).isoformat(), "Last 3 months"
    if period == "year":
        return f"{y}-01-01", f"{y}-12-31", str(y)
    if period == "all":
        return None, None, "All time"
    return (today - timedelta(days=29)).isoformat(), today.isoformat(), "Last 30 days"


async def _transactions(db, start: str | None, end: str | None) -> list[dict]:
    """Transactions in range, each with `eur`: its amount in EUR at the rate on
    its date (the Finances page's rule)."""
    import fx
    where, params = [], []
    if start:
        where.append("date >= ?"); params.append(start)
    if end:
        where.append("date <= ?"); params.append(end)
    sql = "SELECT * FROM finances_transactions" + (f" WHERE {' AND '.join(where)}" if where else "") + " ORDER BY date DESC"
    async with db.execute(sql, params) as c:
        rows = [dict(r) for r in await c.fetchall()]
    if not rows:
        return rows
    table = await fx.ensure(db, {(r.get("currency") or "EUR").upper() for r in rows}, since=min(r["date"] for r in rows))
    for r in rows:
        try:
            r["eur"] = round(table.convert(float(r["amount"] or 0), (r.get("currency") or "EUR").upper(), "EUR", r["date"]), 2)
        except fx.NoRate:
            r["eur"] = None
    return rows


def _cat(t: dict) -> str:
    return (t.get("category") or "").strip() or UNCATEGORISED


def _txn_row(t: dict) -> dict:
    return {"id": t["id"], "date": t["date"], "merchant": t["merchant"], "category": _cat(t),
            "type": t["type"], "amount": t["amount"], "currency": t.get("currency") or "EUR", "eur": t.get("eur")}


def _totals(txns: list[dict], kind: str, by: str) -> list[dict]:
    want = "income" if kind == "income" else "expense"
    sums, counts = defaultdict(float), defaultdict(int)
    for t in txns:
        if t["type"] != want or t.get("eur") is None:
            continue
        key = _cat(t) if by == "category" else (t["merchant"] or "?")
        sums[key] += t["eur"]; counts[key] += 1
    rows = [{"label": k, "amount": round(v, 2), "count": counts[k]} for k, v in sums.items()]
    rows.sort(key=lambda r: -r["amount"])
    return rows


def _fold(rows: list[dict], n: int = CARD_ROWS) -> list[dict]:
    if len(rows) <= n:
        return rows
    rest = rows[n - 1:]
    return rows[:n - 1] + [{"label": "Other", "amount": round(sum(r["amount"] for r in rest), 2),
                            "count": sum(r["count"] for r in rest), "other": len(rest)}]


# ── Tool definitions ─────────────────────────────────────────────────────────

_period_props = {
    "period": {"type": "string", "enum": PERIODS, "description": "30d (default), month (this calendar month), last-month, 3m, year, all"},
    "start": {"type": "string", "description": "YYYY-MM-DD, instead of period"},
    "end": {"type": "string", "description": "YYYY-MM-DD, instead of period"},
}

TOOLS = [
    # Finance — investigate
    Tool(name="finance_breakdown",
         description="Spending or income totals by category or merchant over a period, in EUR. Draws a chart in the chat. Use for 'where did my money go', 'breakdown of last 30 days', etc.",
         inputSchema={"type": "object", "properties": {
             **_period_props,
             "kind": {"type": "string", "enum": ["spending", "income"], "description": "default spending"},
             "by": {"type": "string", "enum": ["category", "merchant"], "description": "default category"},
             "category": {"type": "string", "description": "Only this category (then break down by merchant)"}},
             "required": []}),
    Tool(name="compare_spending",
         description="Compare spending (or income) between two periods, by category, to explain what changed — e.g. this month vs last month.",
         inputSchema={"type": "object", "properties": {
             "period_a": {"type": "string", "enum": PERIODS, "description": "The period to explain, e.g. month"},
             "period_b": {"type": "string", "enum": PERIODS, "description": "What to compare against, e.g. last-month"},
             "kind": {"type": "string", "enum": ["spending", "income"]}},
             "required": ["period_a", "period_b"]}),
    Tool(name="search_transactions",
         description="Find transactions by merchant text, category, amount and/or date range. Returns ids for re-categorising. Draws a list in the chat.",
         inputSchema={"type": "object", "properties": {
             "query": {"type": "string", "description": "Text in the merchant/description"},
             "category": {"type": "string", "description": "Exact category; 'Uncategorised' for none"},
             **_period_props,
             "kind": {"type": "string", "enum": ["spending", "income"]},
             "min_amount": {"type": "number"}, "max_amount": {"type": "number"},
             "limit": {"type": "integer", "description": "default 25, max 100"}},
             "required": []}),
    Tool(name="list_categories",
         description="Every transaction category in use, with how many transactions and how much in the last 90 days, plus the auto-categorise rules.",
         inputSchema={"type": "object", "properties": {}, "required": []}),
    Tool(name="list_recurring",
         description="Subscriptions and bills: merchants that charge on a regular cadence, with amount, next due date and yearly cost.",
         inputSchema={"type": "object", "properties": {}, "required": []}),
    Tool(name="get_budgets",
         description="Monthly budgets with what's been spent against each this month.",
         inputSchema={"type": "object", "properties": {}, "required": []}),
    # Finance — change
    Tool(name="set_transaction_category",
         description="Set the category on one or more transactions (by id from search_transactions). A new category name creates the category.",
         inputSchema={"type": "object", "properties": {
             "ids": {"type": "array", "items": {"type": "string"}}, "category": {"type": "string"}},
             "required": ["ids", "category"]}),
    Tool(name="rename_category",
         description="Rename a category everywhere (transactions and rules). Renaming to an existing category merges the two.",
         inputSchema={"type": "object", "properties": {"old": {"type": "string"}, "new": {"type": "string"}}, "required": ["old", "new"]}),
    Tool(name="add_category_rule",
         description="Auto-categorise: transactions whose merchant contains `pattern` get `category`, on future imports and (by default) existing uncategorised or AI-guessed ones now.",
         inputSchema={"type": "object", "properties": {
             "pattern": {"type": "string"}, "category": {"type": "string"},
             "apply_to_existing": {"type": "boolean", "description": "default true"}},
             "required": ["pattern", "category"]}),
    Tool(name="set_budget",
         description="Create or change a monthly budget (EUR). `categories` lets one budget cover several categories; defaults to the one it's named after.",
         inputSchema={"type": "object", "properties": {
             "name": {"type": "string"}, "amount": {"type": "number"},
             "categories": {"type": "array", "items": {"type": "string"}}},
             "required": ["name", "amount"]}),
    # Calendar
    Tool(name="search_events",
         description="Find calendar events whose title, description or location contains a query, across a date range (default: 30 days back to 60 ahead).",
         inputSchema={"type": "object", "properties": {
             "query": {"type": "string"}, "start": {"type": "string"}, "end": {"type": "string"}}, "required": ["query"]}),
    Tool(name="find_free_time",
         description="Free slots of at least `hours` between existing events, per day, within waking hours (default 8–22). Use before scheduling something new.",
         inputSchema={"type": "object", "properties": {
             "start": {"type": "string", "description": "YYYY-MM-DD, default today"},
             "end": {"type": "string", "description": "YYYY-MM-DD, default start + 6 days"},
             "hours": {"type": "number", "description": "default 1"},
             "earliest": {"type": "number", "description": "default 8"}, "latest": {"type": "number", "description": "default 22"}},
             "required": []}),
    Tool(name="show_day",
         description="Draw one day's calendar in the chat (e.g. after rescheduling, to show the result).",
         inputSchema={"type": "object", "properties": {"date": {"type": "string"}, "days": {"type": "integer", "description": "How many days from date, 1 (default) to 7"},
                                                       "highlight": {"type": "string", "description": "Event id to highlight"}}, "required": ["date"]}),
    # Other edits
    Tool(name="create_habit",
         description="Add a habit to track daily.",
         inputSchema={"type": "object", "properties": {
             "name": {"type": "string"}, "period": {"type": "string", "enum": ["morning", "daytime", "evening"]}},
             "required": ["name"]}),
    Tool(name="update_goal",
         description="Edit a goal: title, calendar tags (comma-separated; calendar events matching a tag count as time on the goal; * is a wildcard) or a quarter's focus text.",
         inputSchema={"type": "object", "properties": {
             "id": {"type": "string"}, "title": {"type": "string"}, "tags": {"type": "string"},
             "quarter": {"type": "string", "enum": ["Q1", "Q2", "Q3", "Q4"]}, "focus": {"type": "string"}},
             "required": ["id"]}),
    Tool(name="add_subtask",
         description="Add a sub-task under an existing to-do.",
         inputSchema={"type": "object", "properties": {"parent_id": {"type": "string"}, "text": {"type": "string"}}, "required": ["parent_id", "text"]}),
    Tool(name="append_to_note",
         description="Add text to the end of a quick note.",
         inputSchema={"type": "object", "properties": {"id": {"type": "string"}, "text": {"type": "string"}}, "required": ["id", "text"]}),
    Tool(name="delete_note",
         description="Delete a quick note.",
         inputSchema={"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}),
    # The app itself
    Tool(name="show",
         description="Open a view in the user's Atlas app so they can see something: a page, the finances for a category and period, a calendar day or event, a note, or a search. Use when they ask to see/open something, or to point at what you just changed.",
         inputSchema={"type": "object", "properties": {
             "view": {"type": "string", "enum": ["home", "calendar", "finances", "todos", "goals", "habits", "notes", "search"]},
             "date": {"type": "string", "description": "calendar: day to open"},
             "event_id": {"type": "string", "description": "calendar: event to open"},
             "category": {"type": "string", "description": "finances: filter the transaction log to this category"},
             "period": {"type": "string", "enum": PERIODS, "description": "finances: period for the filter"},
             "kind": {"type": "string", "enum": ["spending", "income"]},
             "note_id": {"type": "string"}, "item_id": {"type": "string", "description": "todos/goals/habits: item to highlight"},
             "query": {"type": "string", "description": "search: what to search for"}},
             "required": ["view"]}),
]

NAMES = {t.name for t in TOOLS}


# ── Handlers ─────────────────────────────────────────────────────────────────

async def dispatch(name: str, args: dict, db, gcal_events=None):
    """Run one of TOOLS. `gcal_events(db, from_date, to_date)` is mcp_server's
    Google Calendar reader (passed in to avoid a circular import)."""
    today = date.today()

    if name == "finance_breakdown":
        start, end, label = period_range(args.get("period"), args.get("start"), args.get("end"))
        kind = args.get("kind") or "spending"
        txns = await _transactions(db, start, end)
        if args.get("category"):
            txns = [t for t in txns if _cat(t).lower() == args["category"].strip().lower()]
        by = args.get("by") or ("merchant" if args.get("category") else "category")
        rows = _totals(txns, kind, by)
        total = round(sum(r["amount"] for r in rows), 2)
        title = f"{'Income' if kind == 'income' else 'Spending'}{' on ' + args['category'] if args.get('category') else ''} · {label}"
        return {
            "period": {"from": start, "to": end, "label": label}, "currency": "EUR", "kind": kind, "by": by,
            "total": total, "transactions": sum(r["count"] for r in rows), "rows": rows[:30],
            "card": {"type": "breakdown", "title": title, "currency": "EUR", "total": total, "by": by, "rows": _fold(rows),
                     "range": {"from": start, "to": end}, "kind": "income" if kind == "income" else "expense",
                     "category": args.get("category")},
            "show": {"kind": "finances", "category": args.get("category"), "range": {"from": start, "to": end},
                     "type": "income" if kind == "income" else "expense"},
        }

    if name == "compare_spending":
        kind = args.get("kind") or "spending"
        a0, a1, alabel = period_range(args["period_a"])
        b0, b1, blabel = period_range(args["period_b"])
        ra = {r["label"]: r["amount"] for r in _totals(await _transactions(db, a0, a1), kind, "category")}
        rb = {r["label"]: r["amount"] for r in _totals(await _transactions(db, b0, b1), kind, "category")}
        rows = [{"label": k, "a": round(ra.get(k, 0), 2), "b": round(rb.get(k, 0), 2), "change": round(ra.get(k, 0) - rb.get(k, 0), 2)}
                for k in set(ra) | set(rb)]
        rows.sort(key=lambda r: -abs(r["change"]))
        ta, tb = round(sum(ra.values()), 2), round(sum(rb.values()), 2)
        return {
            "currency": "EUR", "a": {"label": alabel, "total": ta}, "b": {"label": blabel, "total": tb}, "change": round(ta - tb, 2),
            "rows": rows[:20],
            "card": {"type": "compare", "title": f"{'Income' if kind == 'income' else 'Spending'}: {alabel} vs {blabel}",
                     "currency": "EUR", "a": {"label": alabel, "total": ta}, "b": {"label": blabel, "total": tb}, "rows": rows[:8],
                     "range": {"from": a0, "to": a1}, "kind": "income" if kind == "income" else "expense"},
        }

    if name == "search_transactions":
        start, end, label = period_range(args.get("period") or ("all" if not (args.get("start") or args.get("end")) else None),
                                         args.get("start"), args.get("end"))
        txns = await _transactions(db, start, end)
        q = (args.get("query") or "").strip().lower()
        cat = (args.get("category") or "").strip().lower()
        want = {"spending": "expense", "income": "income"}.get(args.get("kind") or "")
        out = [t for t in txns
               if (not q or q in (t["merchant"] or "").lower())
               and (not cat or _cat(t).lower() == cat)
               and (not want or t["type"] == want)
               and (args.get("min_amount") is None or (t.get("eur") or 0) >= args["min_amount"])
               and (args.get("max_amount") is None or (t.get("eur") or 0) <= args["max_amount"])]
        limit = max(1, min(int(args.get("limit") or 25), 100))
        rows = [_txn_row(t) for t in out[:limit]]
        total = round(sum((t.get("eur") or 0) * (1 if t["type"] == "income" else -1) for t in out), 2)
        what = " · ".join(x for x in [f"“{args['query']}”" if q else "", args.get("category") or "", label] if x)
        return {
            "matches": len(out), "shown": len(rows), "net_eur": total, "transactions": rows,
            "card": {"type": "transactions", "title": f"Transactions · {what}", "currency": "EUR", "total": total,
                     "matches": len(out), "rows": [{k: r[k] for k in ("id", "date", "merchant", "category", "type", "eur")} for r in rows[:12]]},
        }

    if name == "list_categories":
        since = (today - timedelta(days=89)).isoformat()
        txns = await _transactions(db, since, None)
        recent = defaultdict(lambda: {"count": 0, "spent": 0.0, "received": 0.0})
        for t in txns:
            r = recent[_cat(t)]
            r["count"] += 1
            r["spent" if t["type"] == "expense" else "received"] += t.get("eur") or 0
        async with db.execute("SELECT COALESCE(NULLIF(TRIM(category), ''), ?) AS c, COUNT(*) AS n FROM finances_transactions GROUP BY 1 ORDER BY 2 DESC", (UNCATEGORISED,)) as c:
            all_time = {r["c"]: r["n"] for r in await c.fetchall()}
        async with db.execute("SELECT pattern, category FROM finances_import_rules ORDER BY sort_order") as c:
            rules = [dict(r) for r in await c.fetchall()]
        return {"categories": [{"name": k, "transactions_all_time": n,
                                "last_90_days": {kk: round(vv, 2) if isinstance(vv, float) else vv for kk, vv in recent[k].items()}}
                               for k, n in all_time.items()],
                "rules": rules}

    if name == "list_recurring":
        import finance_insights
        txns = await _transactions(db, (today - timedelta(days=400)).isoformat(), None)
        rows = finance_insights.find_recurring(txns, today, value=lambda t: t.get("eur") or 0)
        return {"currency": "EUR", "recurring": rows,
                "yearly_total": round(sum(r["annualised"] for r in rows), 2)}

    if name == "get_budgets":
        import finance_insights
        async with db.execute("SELECT * FROM finances_budgets ORDER BY category") as c:
            budgets = [dict(r) for r in await c.fetchall()]
        s, e, _ = period_range("month")
        txns = await _transactions(db, s, e)
        status, unbudgeted = (finance_insights.budget_status(budgets, txns, value=lambda t: t.get("eur") or 0)
                              if budgets else ([], None))
        import calendar
        elapsed = today.day / calendar.monthrange(today.year, today.month)[1]
        card = {"type": "budgets", "title": f"Budgets · {today.strftime('%B')}", "currency": "EUR", "elapsed": round(elapsed, 3),
                "rows": [{"name": b["category"], "spent": b["spent"], "amount": float(b.get("amount") or 0), "pace": b["pace"],
                          "categories": b.get("categories") or []} for b in status]} if status else None
        return {"currency": "EUR", "month": today.strftime("%B %Y"), "budgets": status, "unbudgeted": unbudgeted,
                **({"card": card, "show": {"kind": "page", "page": "finances"}} if card else {})}

    if name == "set_transaction_category":
        ids = [str(i) for i in args.get("ids") or []][:500]
        category = (args.get("category") or "").strip()
        if not ids or not category:
            return {"error": "Pass ids and a category"}
        marks = ",".join("?" * len(ids))
        before = await snapshot(db, "finances_transactions", f"id IN ({marks})", ids)
        if not before:
            return {"error": "No transactions with those ids"}
        await db.execute(f"UPDATE finances_transactions SET category = ?, category_source = 'manual' WHERE id IN ({marks})",
                         [category, *ids])
        await db.commit()
        who = before[0]["merchant"] if len(before) == 1 else f"{len(before)} transactions"
        undo_id = await actions.record(db, name, f"Categorised {who} as {category}",
                                       {"sql": restore_rows("finances_transactions", before)},
                                       {"kind": "finances", "category": category})
        olds = sorted({_cat(b) for b in before})
        card = change_card(f"Category · {who}", [("Category", ", ".join(olds), category)], {"kind": "finances", "category": category})
        return {"ok": True, "updated": len(before), "category": category, "undo_id": undo_id, "card": card}

    if name == "rename_category":
        old, new = (args.get("old") or "").strip(), (args.get("new") or "").strip()
        if not old or not new or old == new:
            return {"error": "Pass two different names"}
        txns = await snapshot(db, "finances_transactions", "LOWER(TRIM(category)) = LOWER(?)", (old,))
        rules = await snapshot(db, "finances_import_rules", "LOWER(TRIM(category)) = LOWER(?)", (old,))
        if not txns and not rules:
            return {"error": f"No category called {old}"}
        await db.execute("UPDATE finances_transactions SET category = ? WHERE LOWER(TRIM(category)) = LOWER(?)", (new, old))
        await db.execute("UPDATE finances_import_rules SET category = ? WHERE LOWER(TRIM(category)) = LOWER(?)", (new, old))
        await db.commit()
        undo_id = await actions.record(db, name, f"Renamed category {old} → {new}",
                                       {"sql": restore_rows("finances_transactions", txns) + restore_rows("finances_import_rules", rules)},
                                       {"kind": "finances", "category": new})
        return {"ok": True, "transactions": len(txns), "rules": len(rules), "undo_id": undo_id,
                "card": change_card(f"Renamed category · {len(txns)} transactions", [("Name", old, new)], {"kind": "finances", "category": new})}

    if name == "add_category_rule":
        pattern, category = (args.get("pattern") or "").strip(), (args.get("category") or "").strip()
        if not pattern or not category:
            return {"error": "Pass a pattern and a category"}
        rule_id = uuid.uuid4().hex
        async with db.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM finances_import_rules") as c:
            order = (await c.fetchone())[0]
        changed = []
        where = "INSTR(LOWER(merchant), ?) > 0 AND (TRIM(COALESCE(category, '')) = '' OR category_source = 'ai')"
        if args.get("apply_to_existing", True):
            changed = await snapshot(db, "finances_transactions", where, (pattern.lower(),))
            await db.execute(f"UPDATE finances_transactions SET category = ?, category_source = 'rule' WHERE {where}",
                             (category, pattern.lower()))
        await db.execute("INSERT INTO finances_import_rules (id, pattern, category, sort_order) VALUES (?,?,?,?)",
                         (rule_id, pattern, category, order))
        await db.commit()
        undo_id = await actions.record(db, name, f"Rule: “{pattern}” → {category}" + (f" ({len(changed)} updated)" if changed else ""),
                                       {"sql": delete_rows("finances_import_rules", "id", [rule_id]) + restore_rows("finances_transactions", changed)},
                                       {"kind": "finances", "category": category})
        return {"ok": True, "rule_id": rule_id, "updated_existing": len(changed), "undo_id": undo_id}

    if name == "set_budget":
        bname = (args.get("name") or "").strip()
        if not bname or args.get("amount") is None:
            return {"error": "Pass a name and an amount"}
        before = await snapshot(db, "finances_budgets", "category = ?", (bname,))
        cats = [c.strip() for c in (args.get("categories") or []) if c.strip()]
        await db.execute(
            "INSERT INTO finances_budgets (id, category, amount, period, currency, categories) VALUES (?,?,?, 'monthly', 'EUR', ?) "
            "ON CONFLICT(category) DO UPDATE SET amount=excluded.amount, categories=excluded.categories",
            (uuid.uuid4().hex, bname, float(args["amount"]), json.dumps(cats) if cats else ""))
        await db.commit()
        undo = {"sql": restore_rows("finances_budgets", before) if before else delete_rows("finances_budgets", "category", [bname])}
        undo_id = await actions.record(db, name, f"Budget {bname}: €{float(args['amount']):g}/month", undo, {"kind": "page", "page": "finances"})
        rows = [("Monthly", f"€{float(before[0]['amount']):g}" if before else None, f"€{float(args['amount']):g}")]
        if cats:
            rows.append(("Counts", (before[0].get("categories") or "").strip("[]").replace('"', "") if before else None, ", ".join(cats)))
        return {"ok": True, "undo_id": undo_id, "card": change_card(f"Budget · {bname}", rows, {"kind": "page", "page": "finances"})}

    if name == "search_events":
        q = (args.get("query") or "").strip().lower()
        start = date.fromisoformat(args["start"]) if args.get("start") else today - timedelta(days=30)
        end = date.fromisoformat(args["end"]) if args.get("end") else today + timedelta(days=60)
        if (end - start).days > 400:
            return {"error": "Search at most ~a year at a time"}
        events = await _all_events(db, start, end, gcal_events)
        hits = [e for e in events if q in " ".join(str(e.get(k) or "") for k in ("title", "description", "location", "notes")).lower()]
        return {"matches": len(hits), "events": hits[:50]}

    if name == "find_free_time":
        start = date.fromisoformat(args["start"]) if args.get("start") else today
        end = date.fromisoformat(args["end"]) if args.get("end") else start + timedelta(days=6)
        hours = float(args.get("hours") or 1)
        lo, hi = float(args.get("earliest", 8)), float(args.get("latest", 22))
        events = await _all_events(db, start, end, gcal_events)
        now_h = datetime.now().hour + datetime.now().minute / 60
        days = []
        d = start
        while d <= end:
            busy = sorted((e["start_h"], e["end_h"]) for e in events if e["date"] == d.isoformat() and not e.get("all_day"))
            cursor = max(lo, now_h if d == today else lo)
            slots = []
            for s, e in busy + [(hi, hi)]:
                if s - cursor >= hours - 1e-9:
                    slots.append({"start": round(cursor, 2), "end": round(min(s, hi), 2)})
                cursor = max(cursor, e)
                if cursor >= hi:
                    break
            days.append({"date": d.isoformat(), "weekday": d.strftime("%a"), "free": slots,
                         "busy": [{"start": e["start_h"], "end": e["end_h"], "title": e["title"]}
                                  for e in events if e["date"] == d.isoformat() and not e.get("all_day")
                                  and e.get("start_h") is not None and e.get("end_h") is not None]})
            d += timedelta(days=1)
        label = f"{hours:g} hour{'s' if hours != 1 else ''}"
        return {"hours_needed": hours, "days": [{k: v for k, v in x.items() if k != "busy"} for x in days],
                "card": {"type": "week", "title": f"Free time · {label} or more", "from": lo, "to": hi, "hours": hours,
                         "days": days[:7]}}

    if name == "show_day":
        d = date.fromisoformat(args["date"])
        n = max(1, min(int(args.get("days") or 1), 7))
        everything = await _all_events(db, d, d + timedelta(days=n - 1), gcal_events)
        keep = ("id", "title", "start_h", "end_h", "all_day", "color")
        days = []
        for i in range(n):
            day = d + timedelta(days=i)
            evs = sorted((e for e in everything if e["date"] == day.isoformat()),
                         key=lambda e: (not e.get("all_day"), e.get("start_h") or 0))
            days.append({"date": day.isoformat(), "title": day.strftime("%A %-d %B" if n == 1 else "%a %-d"),
                         "events": [{k: e.get(k) for k in keep} for e in evs[:16]]})
        title = days[0]["title"] if n == 1 else f"{d.strftime('%a %-d %b')} – {(d + timedelta(days=n - 1)).strftime('%a %-d %b')}"
        return {"date": d.isoformat(), "events": [e for day in days for e in day["events"]],
                "card": {"type": "day", "date": d.isoformat(), "title": title, "highlight": args.get("highlight"),
                         "days": days, "events": days[0]["events"]},
                "show": {"kind": "calendar", "date": d.isoformat()}}

    if name == "create_habit":
        hid = uuid.uuid4().hex
        color = HABIT_COLORS.get((args.get("period") or "daytime").lower(), HABIT_COLORS["daytime"])
        await db.execute("INSERT INTO habits (id, name, color, created_at) VALUES (?,?,?,?)",
                         (hid, args["name"], color, today.isoformat()))
        await db.commit()
        undo_id = await actions.record(db, name, f"Added habit “{args['name']}”",
                                       {"sql": delete_rows("habits", "id", [hid])}, {"kind": "habit", "id": hid})
        return {"ok": True, "id": hid, "undo_id": undo_id}

    if name == "update_goal":
        before = await snapshot(db, "goals", "id = ?", (args["id"],))
        if not before:
            return {"error": "No goal with that id"}
        sets, params, what = [], [], []
        if args.get("title"):
            sets.append("title = ?"); params.append(args["title"]); what.append("title")
        if args.get("tags") is not None:
            sets.append("tags = ?"); params.append(args["tags"]); what.append("tags")
        if args.get("quarter") and args.get("focus") is not None:
            sets.append(f"{args['quarter'].lower()} = ?"); params.append(args["focus"]); what.append(f"{args['quarter']} focus")
        if not sets:
            return {"error": "Nothing to change"}
        await db.execute(f"UPDATE goals SET {', '.join(sets)} WHERE id = ?", [*params, args["id"]])
        await db.commit()
        undo_id = await actions.record(db, name, f"Changed {', '.join(what)} on “{before[0]['title']}”",
                                       {"sql": restore_rows("goals", before)}, {"kind": "goal", "id": args["id"]})
        b = before[0]
        rows = [("Title", b["title"], args.get("title") or b["title"]), ("Calendar tags", b.get("tags"), args["tags"] if args.get("tags") is not None else b.get("tags"))]
        if args.get("quarter") and args.get("focus") is not None:
            rows.append((f"{args['quarter']} focus", b.get(args["quarter"].lower()), args["focus"]))
        return {"ok": True, "undo_id": undo_id, "card": change_card(f"Goal · {b['title']}", rows, {"kind": "goal", "id": args["id"]})}

    if name == "add_subtask":
        parent = await snapshot(db, "todos", "id = ?", (args["parent_id"],))
        if not parent:
            return {"error": "No to-do with that id"}
        tid = str(uuid.uuid4())
        async with db.execute("SELECT COALESCE(MAX(sort_order),-1)+1 FROM todos WHERE parent_id=?", (args["parent_id"],)) as c:
            order = (await c.fetchone())[0]
        await db.execute("INSERT INTO todos (id,text,bucket,goal_id,parent_id,done,created_at,sort_order) VALUES (?,?,?,?,?,0,?,?)",
                         (tid, args["text"], parent[0]["bucket"], parent[0]["goal_id"], args["parent_id"], today.isoformat(), order))
        await db.commit()
        undo_id = await actions.record(db, name, f"Added “{args['text']}” under “{parent[0]['text']}”",
                                       {"sql": delete_rows("todos", "id", [tid])}, {"kind": "todo", "id": args["parent_id"]})
        return {"ok": True, "id": tid, "undo_id": undo_id}

    if name in ("append_to_note", "delete_note"):
        before = await snapshot(db, "notes", "id = ?", (args["id"],))
        if not before:
            return {"error": "No note with that id"}
        first = next((l for l in (before[0]["body"] or "").splitlines() if l.strip()), "Untitled").lstrip("# ").strip()[:60]
        if name == "delete_note":
            await db.execute("DELETE FROM notes WHERE id = ?", (args["id"],))
            summary, show = f"Deleted note “{first}”", None
        else:
            body = (before[0]["body"] or "").rstrip("\n") + "\n" + args["text"]
            await db.execute("UPDATE notes SET body = ?, updated_at = ? WHERE id = ?",
                             (body, datetime.now(timezone.utc).isoformat(), args["id"]))
            summary, show = f"Added to note “{first}”", {"kind": "note", "id": args["id"]}
        await db.commit()
        undo_id = await actions.record(db, name, summary, {"sql": restore_rows("notes", before)}, show)
        out = {"ok": True, "undo_id": undo_id}
        if name == "append_to_note":
            from agent_cards import note_card
            out["card"] = {**note_card(args["id"], body), "added": args["text"][:400]}
        return out

    if name == "show":
        v = args["view"]
        if v == "calendar":
            show = {"kind": "event", "id": args["event_id"], "date": args.get("date")} if args.get("event_id") and args.get("date") \
                else {"kind": "calendar", "date": args.get("date") or today.isoformat()}
        elif v == "finances":
            s, e, _ = period_range(args.get("period")) if args.get("period") else (None, None, "")
            show = {"kind": "finances", "category": args.get("category"),
                    "range": {"from": s, "to": e}, "type": "income" if args.get("kind") == "income" else "expense"}
        elif v == "notes" and args.get("note_id"):
            show = {"kind": "note", "id": args["note_id"]}
        elif v in ("todos", "goals", "habits") and args.get("item_id"):
            show = {"kind": {"todos": "todo", "goals": "goal", "habits": "habit"}[v], "id": args["item_id"]}
        elif v == "search":
            show = {"kind": "search", "query": args.get("query") or ""}
        else:
            show = {"kind": "page", "page": v}
        # The browser that's following this conversation acts on `show`.
        return {"ok": True, "show": {**show, "explicit": True}, "note": "Opened in the app."}

    return None


async def _all_events(db, start: date, end: date, gcal_events) -> list[dict]:
    """Local and Google events in range, in one shape: id, title, date,
    start_h, end_h, all_day, color, source."""
    async with db.execute("SELECT * FROM local_events WHERE date >= ? AND date <= ? ORDER BY date, start_h",
                          (start.isoformat(), end.isoformat())) as c:
        out = [{"id": r["id"], "title": r["title"], "date": r["date"], "start_h": r["start_h"], "end_h": r["end_h"],
                "all_day": False, "color": r["color"], "notes": r["notes"], "source": "local"} for r in await c.fetchall()]
    for e in (await gcal_events(db, start, end)) if gcal_events else []:
        def hours(stamp):
            if not stamp or len(stamp) <= 10:
                return None
            t = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
            return t.hour + t.minute / 60
        sh, eh = hours(e.get("start")), hours(e.get("end"))
        if eh is not None and sh is not None and eh <= sh:
            eh = 24.0   # runs past midnight
        out.append({"id": e["id"], "title": e["title"], "date": e["date"], "start_h": sh, "end_h": eh,
                    "all_day": e.get("all_day", False), "color": e.get("color"), "description": e.get("description"),
                    "location": e.get("location"), "source": "google"})
    return out
