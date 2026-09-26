"""
Budgets, recurring spend, and what to do with what's left.

Pure functions over transaction rows. The hard part is not arithmetic, it is
saying "this is a subscription" without being wrong often enough to be annoying:
a false positive here tells you that you pay £4.29 a month for a sandwich.
"""
import re
import statistics
from datetime import date, datetime, timedelta
from typing import Iterable, Optional


def gbp(t: dict) -> float:
    """Every amount is compared in GBP at its import-time rate."""
    return float(t.get("amount") or 0) * float(t.get("fx_rate") or 1)


def month_of(t: dict) -> str:
    return (t.get("date") or "")[:7]


def current_month(today: Optional[date] = None) -> str:
    d = today or date.today()
    return f"{d.year}-{d.month:02d}"


# ── Budgets ───────────────────────────────────────────────────────────────────

def budget_status(budgets: Iterable[dict], transactions: Iterable[dict],
                  month: Optional[str] = None, today: Optional[date] = None) -> list[dict]:
    """Spend against each budget for a month, with a pace figure.

    `pace` is what makes this useful mid-month: £90 of a £100 budget is fine on
    the 28th and alarming on the 3rd. It is the fraction of the budget spent
    divided by the fraction of the month elapsed — 1.0 is exactly on track.
    """
    today = today or date.today()
    month = month or current_month(today)

    spend: dict[str, float] = {}
    for t in transactions:
        if t.get("type") != "expense" or month_of(t) != month:
            continue
        key = (t.get("category") or "Uncategorised").strip()
        spend[key] = spend.get(key, 0) + gbp(t)

    year, mon = int(month[:4]), int(month[5:7])
    days_in_month = (date(year + (mon == 12), (mon % 12) + 1, 1) - date(year, mon, 1)).days
    elapsed = today.day / days_in_month if current_month(today) == month else 1.0
    elapsed = min(max(elapsed, 1 / days_in_month), 1.0)

    out = []
    for b in budgets:
        category = b["category"]
        limit = float(b.get("amount") or 0)
        used = round(spend.get(category, 0), 2)
        out.append({
            **b,
            "spent": used,
            "remaining": round(limit - used, 2),
            "pct": round(used / limit * 100) if limit > 0 else 0,
            "pace": round((used / limit) / elapsed, 2) if limit > 0 else 0,
            "over": used > limit > 0,
        })

    # Spending with no budget attached is the blind spot a budget page creates,
    # so it is reported rather than quietly omitted.
    budgeted = {b["category"] for b in budgets}
    unbudgeted = [{"category": c, "spent": round(v, 2)}
                  for c, v in spend.items() if c not in budgeted]
    unbudgeted.sort(key=lambda r: -r["spent"])

    out.sort(key=lambda r: -r["spent"])
    return out, unbudgeted


# ── Recurring spend ───────────────────────────────────────────────────────────

# Trailing card/reference noise: "SPOTIFY 4829", "NETFLIX.COM ON 03 APR".
_NOISE = re.compile(r"\b(\d{3,}|ON \d{1,2} \w{3}|REF\s*\S+|\d{2}/\d{2})\b", re.I)


def normalise_merchant(name: str) -> str:
    """Collapse a bank description to something stable across months.

    Deliberately conservative: over-normalising merges distinct merchants, and a
    merged group produces confident nonsense about a subscription you don't have.
    """
    text = _NOISE.sub(" ", (name or "").upper())
    text = re.sub(r"[^A-Z0-9&. ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


# name, expected gap in days, tolerance, payments per year
_CADENCES = [
    ("weekly", 7, 2, 52),
    ("fortnightly", 14, 3, 26),
    ("monthly", 30, 5, 12),
    ("quarterly", 91, 10, 4),
    ("annual", 365, 20, 1),
]

# Payments per year comes from the cadence, not from 365/median_gap. Months are
# not 30 days, so the arithmetic version reports 11.8 payments a year for a
# monthly subscription — right to two decimal places and wrong to a human.
_PER_YEAR = {name: n for name, _, _, n in _CADENCES}


def _classify_gap(days: float) -> Optional[str]:
    for name, centre, tolerance, _ in _CADENCES:
        if abs(days - centre) <= tolerance:
            return name
    return None


def find_recurring(transactions: Iterable[dict], today: Optional[date] = None,
                   min_occurrences: int = 3) -> list[dict]:
    """Merchants billing on a regular cadence.

    Three occurrences minimum: two points make a line through any pair of dates,
    which is how a fortnightly shop becomes a "subscription".
    """
    today = today or date.today()

    groups: dict[str, list[dict]] = {}
    for t in transactions:
        if t.get("type") != "expense":
            continue
        key = normalise_merchant(t.get("merchant", ""))
        if key:
            groups.setdefault(key, []).append(t)

    out = []
    for key, rows in groups.items():
        if len(rows) < min_occurrences:
            continue
        rows = sorted(rows, key=lambda r: r["date"])
        dates = [datetime.strptime(r["date"], "%Y-%m-%d").date() for r in rows]
        gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
        gaps = [g for g in gaps if g > 0]
        if not gaps:
            continue

        median_gap = statistics.median(gaps)
        cadence = _classify_gap(median_gap)
        if not cadence:
            continue

        # Irregular intervals mean it is habit, not billing.
        spread = statistics.pstdev(gaps) if len(gaps) > 1 else 0
        if spread > max(median_gap * 0.35, 3):
            continue

        amounts = [gbp(r) for r in rows]
        median_amount = statistics.median(amounts)
        varies = any(abs(a - median_amount) > max(median_amount * 0.15, 0.5) for a in amounts)

        next_due = dates[-1] + timedelta(days=round(median_gap))
        out.append({
            "merchant": key,
            "label": rows[-1].get("merchant", key),
            "category": rows[-1].get("category", ""),
            "cadence": cadence,
            "occurrences": len(rows),
            "amount": round(median_amount, 2),
            "varies": varies,
            "last_seen": dates[-1].isoformat(),
            "next_due": next_due.isoformat(),
            # Well past due: either cancelled, or a payment that failed quietly.
            "overdue": next_due < today - timedelta(days=max(round(median_gap * 0.5), 5)),
            "annualised": round(median_amount * _PER_YEAR[cadence], 2),
        })

    out.sort(key=lambda r: -r["annualised"])
    return out


# ── Surplus ───────────────────────────────────────────────────────────────────

def surplus_for(transactions: Iterable[dict], month: Optional[str] = None,
                today: Optional[date] = None) -> dict:
    month = month or current_month(today)
    rows = [t for t in transactions if month_of(t) == month]
    income = sum(gbp(t) for t in rows if t.get("type") == "income")
    spending = sum(gbp(t) for t in rows if t.get("type") == "expense")
    return {
        "month": month,
        "income": round(income, 2),
        "spending": round(spending, 2),
        "surplus": round(income - spending, 2),
    }


def suggest_allocation(surplus: float, pots: Iterable[dict]) -> list[dict]:
    """Split a surplus across pots that still need money.

    Proportional to what each pot has left to raise, so the nearly-finished pot
    does not soak up everything. Returns a suggestion only — nothing here writes
    a deposit, because money moving without being asked is the one behaviour a
    finance tool must never have.
    """
    if surplus <= 0:
        return []
    needing = []
    for p in pots:
        target = float(p.get("target_amount") or p.get("targetAmount") or 0)
        saved = float(p.get("saved") or 0)
        if target > saved:
            needing.append((p, target - saved))
    if not needing:
        return []

    total_need = sum(n for _, n in needing)
    out = []
    for p, need in needing:
        share = surplus * (need / total_need)
        out.append({
            "pot_id": p["id"],
            "name": p.get("name", ""),
            "shortfall": round(need, 2),
            "suggested": round(min(share, need), 2),
        })
    out.sort(key=lambda r: -r["suggested"])
    return out
