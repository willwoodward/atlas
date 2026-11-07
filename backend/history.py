"""
Values over time, for the history charts.

Recorded values come from daily_snapshots (snapshots.py: once an hour since
it was switched on). Before the first recording, the line is estimated where
the data allows, and every point says which it is:

  net_worth, account:<id>   today's balances walked back through the
                            imported transactions (an account without
                            transactions is held flat). Balances in other
                            currencies at today's rate, like the Finances page.
  saved                     pot deposits added up by date (exact)
  open_todos                to-dos created by then and not yet finished (the
                            ones listed on the To-do page, not their sub-tasks);
                            ones ticked off before finish times were kept,
                            or deleted, can't be counted, so it's a guess.
                            Today's point is always live

Plus two that are always exact, straight from their dated records:

  cashflow   income and spending per month (EUR at each transaction's rate)
  habits     each habit's share of days done, week by week

Long ranges are thinned to one point a week (over ~4 months) or a month
(over 2 years), each the value at the end of that week or month.
"""
from collections import defaultdict
from datetime import date, timedelta

RANGES = {"30d": 30, "90d": 90, "1y": 365, "all": None}


def _days(start: date, end: date) -> list[date]:
    n = (end - start).days
    if n <= 120:
        step = [start + timedelta(days=i) for i in range(n + 1)]
    elif n <= 730:
        # Sundays (week ends), and today.
        first = start + timedelta(days=(6 - start.weekday()) % 7)
        step = [first + timedelta(weeks=i) for i in range((end - first).days // 7 + 1)]
    else:
        step, d = [], start
        while d <= end:
            nxt = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
            step.append(min(nxt - timedelta(days=1), end))
            d = nxt
    if not step or step[-1] != end:
        step.append(end)
    return [d for d in step if start <= d <= end]


async def _recorded(db, key: str) -> dict[str, float]:
    async with db.execute("SELECT date, value FROM daily_snapshots WHERE key=? ORDER BY date", (key,)) as c:
        return {r[0]: r[1] for r in await c.fetchall()}


def _with_recorded(days: list[date], recorded: dict[str, float], estimate) -> list[dict]:
    """A value per day: the recorded one if there is one for that day (or the
    last before it, once recording has started), else the estimate."""
    first = min(recorded) if recorded else None
    out, last = [], None
    ordered = sorted(recorded)
    i = 0
    for d in days:
        s = d.isoformat()
        while i < len(ordered) and ordered[i] <= s:
            last = recorded[ordered[i]]
            i += 1
        if first and s >= first:
            out.append({"date": s, "value": round(last, 2), "estimated": False})
        else:
            v = estimate(d)
            if v is not None:
                out.append({"date": s, "value": round(v, 2), "estimated": True})
    return out


async def _accounts_and_txns(db):
    async with db.execute("SELECT id, name, type, balance, currency FROM finances_accounts ORDER BY name") as c:
        accounts = [dict(r) for r in await c.fetchall()]
    async with db.execute("SELECT account_id, type, amount, date FROM finances_transactions WHERE account_id IS NOT NULL") as c:
        txns = [dict(r) for r in await c.fetchall()]
    per = defaultdict(list)
    for t in txns:
        per[t["account_id"]].append(t)
    return accounts, per


def _balance_on(account: dict, txns: list[dict], d: date) -> float:
    """The account's balance at the end of `d`: today's, minus what came in
    since (plus what went out). A credit card's balance is what's owed."""
    s = d.isoformat()
    after = sum((t["amount"] if t["type"] == "income" else -t["amount"]) for t in txns if t["date"] > s)
    bal = float(account["balance"] or 0)
    return bal - after if account["type"] != "credit" else bal + after


async def balance_line(db, key: str, today: date | None = None):
    """Net worth, or one account, as a function of the day: (meta, value_on(d), oldest).

    Walked back from today's balances through the transactions by *their own
    dates*. The hourly recordings are deliberately not used for an account that
    has transactions: its balance only changes when a statement is imported, so
    a recording would show the whole of an import landing on the day it was
    uploaded, flat before it. An account with no transactions has nothing to
    walk back through, so it follows its recordings (or its balance, held flat).
    `oldest` is the earliest transaction: before it, balances are a guess."""
    import fx
    from bisect import bisect_right
    today = today or date.today()
    accounts, per = await _accounts_and_txns(db)
    if key.startswith("account:"):
        want = key[8:].strip().lower()
        # By id, or by name ("account:Wise"), so Atlas can ask by name.
        accounts = ([a for a in accounts if a["id"] == key[8:]]
                    or [a for a in accounts if (a["name"] or "").strip().lower() == want])
    if not accounts:
        return None
    table = await fx.ensure(db, {(a["currency"] or "EUR").upper() for a in accounts})
    recs = {}
    for a in accounts:
        if not per.get(a["id"]):
            rec = await _recorded(db, f"account:{a['id']}")
            recs[a["id"]] = (sorted(rec), rec)

    def at(a, d):
        if per.get(a["id"]):
            return _balance_on(a, per[a["id"]], d)
        days, rec = recs[a["id"]]
        i = bisect_right(days, d.isoformat()) if d < today else 0      # today is what the balance is now

        return rec[days[i - 1]] if i else float(a["balance"] or 0)

    def value_on(d):
        if key.startswith("account:"):
            return at(accounts[0], d)
        total = 0.0
        for a in accounts:
            try:
                v = table.convert(at(a, d), (a["currency"] or "EUR").upper(), "EUR")
            except fx.NoRate:
                continue
            total += -v if a["type"] == "credit" else v
        return total

    if key.startswith("account:"):
        a = accounts[0]
        meta = {"key": f"account:{a['id']}", "label": a["name"], "unit": "money", "currency": (a["currency"] or "EUR").upper()}
    else:
        meta = {"key": "net_worth", "label": "Net worth", "unit": "money", "currency": "EUR"}
    oldest = min((t["date"] for a in accounts for t in per.get(a["id"], [])), default=None)
    return meta, value_on, oldest


async def series(db, key: str, range_: str = "90d", today: date | None = None) -> dict | None:
    import fx
    today = today or date.today()
    recorded = await _recorded(db, key)
    if key == "open_todos":
        # Recordings made before sub-tasks were left out counted finished work
        # as open: ignore them, and fall back to the estimate for those days.
        async with db.execute("SELECT value FROM app_settings WHERE key = 'history.open_todos_from'") as c:
            row = await c.fetchone()
        from_day = row[0] if row else today.isoformat()
        recorded = {d: v for d, v in recorded.items() if d >= from_day}
    balance = None
    if key == "net_worth" or key.startswith("account:"):
        balance = await balance_line(db, key, today)
        if balance is None:
            # No accounts yet: nothing to draw, but not a missing line.
            return None if key != "net_worth" else {"key": key, "label": "Net worth", "unit": "money", "currency": "EUR",
                                                    "range": range_, "points": [], "recorded_since": None}
        meta, estimate, oldest = balance
        meta = {k: v for k, v in meta.items() if k != "key"}
        key = balance[0]["key"]
        recorded = {}
        start_hint = oldest

    elif key == "saved":
        async with db.execute("SELECT d.amount, d.date, p.currency FROM finances_deposits d JOIN finances_pots p ON p.id = d.pot_id") as c:
            deposits = [dict(r) for r in await c.fetchall()]
        table = await fx.ensure(db, {(r["currency"] or "EUR").upper() for r in deposits}) if deposits else None

        def estimate(d):
            s = d.isoformat()
            total = 0.0
            for r in deposits:
                if (r["date"] or "")[:10] <= s:
                    try:
                        total += table.convert(float(r["amount"] or 0), (r["currency"] or "EUR").upper(), "EUR")
                    except fx.NoRate:
                        pass
            return total
        meta = {"label": "Saved in pots", "unit": "money", "currency": "EUR"}
        start_hint = min(((r["date"] or "")[:10] for r in deposits), default=None)

    elif key == "open_todos":
        async with db.execute("SELECT created_at, done, completed_at FROM todos WHERE parent_id IS NULL") as c:
            todos = [dict(r) for r in await c.fetchall()]

        def estimate(d):
            s = d.isoformat()
            n = 0
            for t in todos:
                if (t["created_at"] or "")[:10] > s:
                    continue
                if t["done"] and not t["completed_at"]:
                    continue   # finished at some unknown time: left out
                if t["done"] and t["completed_at"][:10] <= s:
                    continue
                n += 1
            return n
        meta = {"label": "Open to-dos", "unit": "count"}
        start_hint = min(((t["created_at"] or "")[:10] for t in todos), default=None)
    else:
        return None

    days_back = RANGES.get(range_, 90)
    if days_back is None:
        first = min([x for x in (start_hint, min(recorded) if recorded else None) if x] or [today.isoformat()])
        start = min(date.fromisoformat(first), today)
    else:
        start = today - timedelta(days=days_back - 1)
    if balance:
        oldest = balance[2]
        # Dashed only before the first transaction, where nothing says what the balance was.
        points = [{"date": d.isoformat(), "value": round(estimate(d), 2), "estimated": oldest is None or d.isoformat() < oldest}
                  for d in _days(start, today)]
    else:
        points = _with_recorded(_days(start, today), recorded, estimate)
    if key == "saved" and points and points[-1]["date"] == today.isoformat():
        # Recordings are hourly; what's in the pots right now isn't.
        points[-1] = {"date": today.isoformat(), "value": round(estimate(today), 2), "estimated": False}
    if key == "open_todos" and points and points[-1]["date"] == today.isoformat():
        # Recordings are hourly; what's open right now isn't.
        async with db.execute("SELECT COUNT(*) FROM todos WHERE done = 0 AND parent_id IS NULL") as c:
            points[-1] = {"date": today.isoformat(), "value": (await c.fetchone())[0], "estimated": False}
    return {"key": key, **meta, "range": range_, "points": points,
            "recorded_since": min(recorded) if recorded else None}


TOP = 5


async def explain(db, key: str, start: str, end: str, range_: str = "90d", today: date | None = None) -> dict | None:
    """Why a balance line moved between two of its points: the biggest things that
    came in and went out in between, by category, and how much of the change
    isn't explained by any transaction (exchange rates, investments, edits to a
    balance, or statements not imported yet).

    `start` and `end` are points the chart shows (same `range_`); the change is
    from the end of `start` to the end of `end`. Only net worth and single
    accounts: they are the lines transactions move."""
    import fx
    if not (key == "net_worth" or key.startswith("account:")):
        raise ValueError("Only net worth or an account can be explained")
    line = await series(db, key, range_, today)
    if not line:
        return None
    pts = {p["date"]: p for p in line["points"]}
    if start not in pts or end not in pts or start >= end:
        raise ValueError("Pick two dates on the chart, start before end")
    accounts, _ = await _accounts_and_txns(db)
    if key == "net_worth":
        scope = accounts
    else:
        scope = [a for a in accounts if a["id"] == line["key"][8:]]
    by_id = {a["id"]: a for a in scope}
    owed = len(scope) == 1 and scope[0]["type"] == "credit"      # a card's line is what's owed: spending raises it
    table = await fx.ensure(db, {(a["currency"] or "EUR").upper() for a in scope}) if scope else None
    async with db.execute("SELECT id, account_id, type, amount, date, merchant, category FROM finances_transactions "
                          "WHERE account_id IS NOT NULL AND date > ? AND date <= ? ORDER BY date", (start, end)) as c:
        txns = [dict(r) for r in await c.fetchall() if r["account_id"] in by_id]
    ids = list(by_id)
    async with db.execute(f"SELECT MAX(date) FROM finances_transactions WHERE account_id IN ({','.join('?' * len(ids))})", ids) as c:
        last_txn = (await c.fetchone())[0] if ids else None

    rows, explained = [], 0.0
    for t in txns:
        a = by_id[t["account_id"]]
        amount = float(t["amount"] or 0)
        if key == "net_worth":
            try:
                amount = table.convert(amount, (a["currency"] or "EUR").upper(), "EUR")
            except fx.NoRate:
                continue
        effect = amount if t["type"] == "income" else -amount
        if owed:
            effect = -effect
        explained += effect
        rows.append({"id": t["id"], "merchant": t["merchant"], "category": (t["category"] or "").strip() or "Uncategorised",
                     "date": t["date"], "amount": round(effect, 2), "account": a["name"]})
    # Money moved between your own accounts is a push and a pull that cancel out
    # in net worth; listing both would bury what actually changed it.
    shown = [r for r in rows if not (key == "net_worth" and r["category"].lower() == "transfer")]
    ups = sorted((r for r in shown if r["amount"] > 0), key=lambda r: -r["amount"])
    downs = sorted((r for r in shown if r["amount"] < 0), key=lambda r: r["amount"])
    cats: dict[str, dict] = {}
    for r in shown:
        c = cats.setdefault(r["category"], {"category": r["category"], "amount": 0.0, "count": 0})
        c["amount"] += r["amount"]
        c["count"] += 1
    categories = sorted(({**c, "amount": round(c["amount"], 2)} for c in cats.values()), key=lambda c: -abs(c["amount"]))[:TOP + 1]
    start_value, end_value = pts[start]["value"], pts[end]["value"]
    change = end_value - start_value
    return {"key": line["key"], "label": line["label"], "currency": line["currency"], "start": start, "end": end,
            "start_value": start_value, "end_value": end_value, "change": round(change, 2),
            "estimated": bool(pts[start]["estimated"] or pts[end]["estimated"]),
            "explained": round(explained, 2), "other": round(change - explained, 2),
            "up": ups[:TOP], "down": downs[:TOP], "categories": categories,
            "count": len(rows), "last_transaction": last_txn}


async def available(db) -> list[dict]:
    """The series there are, for a picker."""
    out = [{"key": "net_worth", "label": "Net worth"}, {"key": "saved", "label": "Saved in pots"}]
    async with db.execute("SELECT id, name, currency FROM finances_accounts ORDER BY name") as c:
        out += [{"key": f"account:{r['id']}", "label": r["name"], "currency": r["currency"]} for r in await c.fetchall()]
    out.append({"key": "open_todos", "label": "Open to-dos"})
    return out


async def cashflow(db, months: int = 12, today: date | None = None) -> dict:
    """Income and spending per calendar month, EUR at each transaction's own rate."""
    import agent_tools
    today = today or date.today()
    months = max(1, min(months, 36))
    first = today.replace(day=1)
    for _ in range(months - 1):
        first = (first - timedelta(days=1)).replace(day=1)
    txns = await agent_tools._transactions(db, first.isoformat(), today.isoformat())
    sums = defaultdict(lambda: {"income": 0.0, "spending": 0.0})
    for t in txns:
        if t.get("eur") is None:
            continue
        k = t["date"][:7]
        if t["type"] == "income":
            sums[k]["income"] += t["eur"]
        elif t["type"] == "expense":
            sums[k]["spending"] += t["eur"]
    out, d = [], first
    while d <= today:
        k = d.strftime("%Y-%m")
        out.append({"month": k, "label": d.strftime("%b"), "income": round(sums[k]["income"], 2),
                    "spending": round(sums[k]["spending"], 2), "current": k == today.strftime("%Y-%m")})
        d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    return {"currency": "EUR", "months": out}


# A habit's time of day is its colour (see HABIT_PERIODS in the app).
HABIT_PERIODS = [("morning", "Morning", "#6f8168"), ("daytime", "Daytime", "#b08a3e"), ("evening", "Evening", "#9a6d84")]


async def habits(db, weeks: int = 12, today: date | None = None) -> dict:
    """Share of habit-days done per week, for Morning, Daytime and Evening habits
    (Monday to Sunday; this week so far). A habit counts from the day it was made."""
    today = today or date.today()
    weeks = max(2, min(weeks, 52))
    monday = today - timedelta(days=today.weekday())
    first = monday - timedelta(weeks=weeks - 1)
    async with db.execute("SELECT id, name, color, created_at FROM habits ORDER BY created_at") as c:
        hs = [dict(r) for r in await c.fetchall()]
    async with db.execute("SELECT habit_id, date FROM habit_completions WHERE date >= ?", (first.isoformat(),)) as c:
        done = defaultdict(set)
        for r in await c.fetchall():
            done[r["habit_id"]].add(r["date"])
    labels = [(first + timedelta(weeks=i)) for i in range(weeks)]
    by_colour = {c.lower(): (i, n, c) for i, n, c in HABIT_PERIODS}
    members = defaultdict(list)
    other = []
    for h in hs:
        slot = by_colour.get((h["color"] or "").lower())
        (members[slot[0]] if slot else other).append(h)
    groups = [(i, n, c, members[i]) for i, n, c in HABIT_PERIODS]
    if other:
        groups.append(("other", "Other", "#9a9488", other))
    out = []
    for gid, name, colour, mine in groups:
        if not mine:
            continue
        pts = []
        for wk in labels:
            possible = ticked = 0
            for h in mine:
                created = (h.get("created_at") or "")[:10]
                for i in range(7):
                    d = wk + timedelta(days=i)
                    if d > today or (created and d.isoformat() < created):
                        continue
                    possible += 1
                    ticked += d.isoformat() in done[h["id"]]
            pts.append(round(ticked / possible * 100) if possible else None)   # None: none of them existed yet
        out.append({"id": gid, "name": name, "color": colour, "habits": len(mine), "values": pts})
    return {"weeks": [w.isoformat() for w in labels], "groups": out}
