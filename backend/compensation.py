"""
Compensation projection.

Employment income is modelled as a plan, not as history: what is contracted to
arrive and when. The bank import already records what actually landed, and the
two are kept apart so a payday is never counted twice.

Pure functions — no database, no network. In particular no share-price lookup:
equity is valued from a price the user maintains by hand, because a dashboard
that phones a market API on every render buys a leak surface and an uptime
dependency for a number that only has to be roughly right.
"""
from datetime import date
from typing import Iterable, Optional


def _month_key(d: date) -> str:
    return f"{d.year}-{d.month:02d}"


def month_range(start: date, count: int) -> list[str]:
    out, year, month = [], start.year, start.month
    for _ in range(count):
        out.append(f"{year}-{month:02d}")
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return out


def _active(component: dict, month: str) -> bool:
    """A component counts in a month if that month is inside its window.
    Blank start/end mean open-ended, which is the common case for base pay."""
    start = (component.get("start_date") or "")[:7]
    end = (component.get("end_date") or "")[:7]
    if start and month < start:
        return False
    if end and month > end:
        return False
    return True


def _monthly_amount(component: dict, month: str) -> float:
    """Annual figures are spread evenly rather than landing on an anniversary —
    the point of this view is cashflow, not the contract's wording."""
    cadence = component.get("cadence", "annual")
    amount = float(component.get("amount") or 0)
    if cadence == "monthly":
        return amount
    if cadence == "annual":
        return amount / 12
    if cadence == "one_off":
        return amount if (component.get("start_date") or "")[:7] == month else 0.0
    return 0.0


def project(
    components: Iterable[dict],
    grants: Iterable[dict],
    vests: Iterable[dict],
    prices: dict[str, dict],
    fx: dict[str, float],
    tax_rate: float = 0.0,
    months: int = 12,
    today: Optional[date] = None,
) -> list[dict]:
    """Month-by-month expected income in GBP, split by kind.

    `fx` maps a currency to its rate against GBP; a missing currency is treated
    as 1.0 rather than dropped, so an un-set rate shows an obviously wrong
    number instead of silently hiding income.
    """
    today = today or date.today()
    keys = month_range(today.replace(day=1), months)
    grants_by_id = {g["id"]: g for g in grants}

    rows = []
    for month in keys:
        buckets = {"base": 0.0, "bonus": 0.0, "oncall": 0.0, "other": 0.0, "equity": 0.0}

        for c in components:
            if not _active(c, month):
                continue
            rate = fx.get(c.get("currency", "GBP"), 1.0)
            kind = c.get("kind", "other")
            if kind not in buckets:
                kind = "other"
            buckets[kind] += _monthly_amount(c, month) * rate

        for v in vests:
            if (v.get("vest_date") or "")[:7] != month:
                continue
            grant = grants_by_id.get(v.get("grant_id"))
            if not grant:
                continue
            price_row = prices.get(grant.get("symbol", ""), {})
            price = float(price_row.get("price") or 0)
            rate = fx.get(price_row.get("currency") or grant.get("currency", "USD"), 1.0)
            buckets["equity"] += float(v.get("units") or 0) * price * rate

        gross = sum(buckets.values())
        rows.append({
            "month": month,
            **{k: round(v, 2) for k, v in buckets.items()},
            "gross": round(gross, 2),
            # A flat effective rate, not a tax calculation. Irish PAYE/USC/PRSI
            # is progressive and situation-dependent; pretending otherwise here
            # would be worse than an obviously approximate number.
            "net": round(gross * (1 - tax_rate), 2),
        })
    return rows


def summarise(rows: list[dict]) -> dict:
    return {
        "gross_12m": round(sum(r["gross"] for r in rows), 2),
        "net_12m": round(sum(r["net"] for r in rows), 2),
        "equity_12m": round(sum(r["equity"] for r in rows), 2),
        "avg_monthly_gross": round(sum(r["gross"] for r in rows) / len(rows), 2) if rows else 0.0,
    }


def unvested_units(grants: list[dict], vests: list[dict], today: Optional[date] = None) -> dict:
    """Units still to come, per grant — the part of comp that is promised but
    not yet real, and the number most worth seeing separately."""
    today = today or date.today()
    iso = today.isoformat()
    out = {}
    for g in grants:
        remaining = sum(float(v.get("units") or 0) for v in vests
                        if v.get("grant_id") == g["id"] and (v.get("vest_date") or "") > iso)
        out[g["id"]] = round(remaining, 4)
    return out
