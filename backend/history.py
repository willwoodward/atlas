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
  open_todos                to-dos created by then and not yet finished;
                            ones ticked off before finish times were kept,
                            or deleted, can't be counted, so it's a guess

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


async def series(db, key: str, range_: str = "90d", today: date | None = None) -> dict | None:
    import fx
    today = today or date.today()
    recorded = await _recorded(db, key)
    accounts, per = (await _accounts_and_txns(db)) if key in ("net_worth",) or key.startswith("account:") else ([], {})

    if key == "net_worth" or key.startswith("account:"):
        if key.startswith("account:"):
            want = key[8:].strip().lower()
            # By id, or by name ("account:Wise"), so Atlas can ask by name.
            accounts = ([a for a in accounts if a["id"] == key[8:]]
                        or [a for a in accounts if (a["name"] or "").strip().lower() == want])
            if not accounts:
                return None
        table = await fx.ensure(db, {(a["currency"] or "EUR").upper() for a in accounts}) if accounts else None
        oldest = min((t["date"] for a in accounts for t in per.get(a["id"], [])), default=None)

        def estimate(d):
            if not accounts:
                return None
            if key.startswith("account:"):
                a = accounts[0]
                return _balance_on(a, per.get(a["id"], []), d)
            total = 0.0
            for a in accounts:
                v = _balance_on(a, per.get(a["id"], []), d)
                try:
                    v = table.convert(v, (a["currency"] or "EUR").upper(), "EUR")
                except fx.NoRate:
                    continue
                total += -v if a["type"] == "credit" else v
            return total
        if key == "net_worth":
            meta = {"label": "Net worth", "unit": "money", "currency": "EUR"}
        else:
            a = accounts[0]
            key = f"account:{a['id']}"
            recorded = await _recorded(db, key)
            meta = {"label": a["name"], "unit": "money", "currency": (a["currency"] or "EUR").upper()}
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
        async with db.execute("SELECT created_at, done, completed_at FROM todos") as c:
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
    points = _with_recorded(_days(start, today), recorded, estimate)
    return {"key": key, **meta, "range": range_, "points": points,
            "recorded_since": min(recorded) if recorded else None}


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


async def habits(db, weeks: int = 12, today: date | None = None) -> dict:
    """Each habit's share of days done, per week (Monday to Sunday; this week so far)."""
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
    out = []
    for h in hs:
        created = (h.get("created_at") or "")[:10]
        pts = []
        for wk in labels:
            days = [wk + timedelta(days=i) for i in range(7) if wk + timedelta(days=i) <= today]
            days = [d for d in days if not created or d.isoformat() >= created]
            if not days:
                pts.append(None)   # didn't exist yet
                continue
            pts.append(round(sum(d.isoformat() in done[h["id"]] for d in days) / len(days) * 100))
        out.append({"id": h["id"], "name": h["name"], "color": h["color"], "values": pts})
    return {"weeks": [w.isoformat() for w in labels], "habits": out}
