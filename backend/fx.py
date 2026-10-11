"""
Exchange rates: ECB daily reference rates, via frankfurter.dev.

Only currency codes and dates leave the server — never an amount or a
merchant. Rates are stored in `fx_daily` as "1 EUR = rate CUR", so any pair
converts through EUR, and a fetch failure falls back to what is already
stored rather than breaking the finances page.

Balances convert at the latest rate; a transaction converts at the rate on its
own date, so last year's spending doesn't drift every time the pound moves.
The ECB publishes on business days only, so a weekend date uses the most
recent rate before it.
"""
import bisect
import logging
import time
from datetime import date, timedelta
from typing import Iterable, Optional

import httpx

log = logging.getLogger(__name__)

API = "https://api.frankfurter.dev/v1"
BASE = "EUR"
DISPLAY_CURRENCIES = ("EUR", "GBP")

# Don't hit the API more than this often when it's failing or up to date.
_RETRY_SECONDS = 3 * 3600
_last_attempt: dict[str, float] = {}


class NoRate(ValueError):
    """No rate is known for a currency at all — the message reaches the user."""


class FxTable:
    """Rates per currency, each a date-sorted series of (date, rate per EUR)."""

    def __init__(self, rows: Iterable[tuple[str, str, float]] = ()):
        series: dict[str, list[tuple[str, float]]] = {}
        for d, cur, rate in rows:
            series.setdefault(cur, []).append((d, rate))
        self._dates: dict[str, list[str]] = {}
        self._rates: dict[str, list[float]] = {}
        for cur, pts in series.items():
            pts.sort()
            self._dates[cur] = [d for d, _ in pts]
            self._rates[cur] = [r for _, r in pts]

    def has(self, cur: str) -> bool:
        return cur == BASE or cur in self._dates

    def latest_date(self, cur: str) -> Optional[str]:
        return self._dates[cur][-1] if cur in self._dates else None

    def rate(self, cur: str, on: Optional[str] = None) -> float:
        """1 EUR in `cur`, on `on` (YYYY-MM-DD) or latest. Uses the last rate
        published on or before the date; before the first known rate, the first."""
        if cur == BASE:
            return 1.0
        if cur not in self._dates:
            raise NoRate(f"No exchange rate available for {cur}")
        dates, rates = self._dates[cur], self._rates[cur]
        if on is None:
            return rates[-1]
        i = bisect.bisect_right(dates, on) - 1
        return rates[max(i, 0)]

    def convert(self, amount: float, frm: str, to: str, on: Optional[str] = None) -> float:
        if frm == to:
            return amount
        return amount / self.rate(frm, on) * self.rate(to, on)

    def series(self, currencies: Iterable[str]) -> dict[str, list[list]]:
        return {c: [[d, r] for d, r in zip(self._dates[c], self._rates[c])]
                for c in currencies if c in self._dates}


async def load(db) -> FxTable:
    async with db.execute("SELECT date, currency, rate FROM fx_daily") as cur:
        return FxTable((r["date"], r["currency"], r["rate"]) for r in await cur.fetchall())


async def _fetch(start: str, currencies: list[str]) -> dict[str, dict[str, float]]:
    async with httpx.AsyncClient(timeout=8) as client:
        r = await client.get(f"{API}/{start}..", params={"base": BASE, "symbols": ",".join(currencies)})
        r.raise_for_status()
        return r.json().get("rates", {})


async def ensure(db, currencies: Iterable[str], since: Optional[str] = None) -> FxTable:
    """Make sure rates exist for `currencies` from `since` (default: 30 days ago)
    up to the latest ECB publication, fetching only what's missing. Never raises
    for a network problem — the stored table is returned as-is."""
    wanted = sorted({c.upper() for c in currencies if c and c.upper() != BASE})
    table = await load(db)
    if not wanted:
        return table
    since = since or (date.today() - timedelta(days=30)).isoformat()

    # Backfill (a currency is new, or rows older than its first rate appeared)
    # always fetches. Catching up to today is throttled: on a weekend, or a
    # weekday before the ECB publishes, "behind today" is the normal state.
    today = date.today().isoformat()
    backfill, catch_up = [], []
    for c in wanted:
        if not table.has(c) or since < table._dates[c][0]:
            backfill.append(since)
        elif table.latest_date(c) < today:
            catch_up.append((date.fromisoformat(table.latest_date(c)) + timedelta(days=1)).isoformat())
    if not backfill and not catch_up:
        return table
    # Any fetch runs through to today, so it also counts as a catch-up. A
    # backfill is throttled per start date, in case the API has nothing that
    # early (a holiday, or before the series begins) and it would repeat.
    key = ",".join(wanted)
    throttle_key = f"{key}|{min(backfill)}" if backfill else key
    if time.time() - _last_attempt.get(throttle_key, 0) < _RETRY_SECONDS:
        return table
    _last_attempt[throttle_key] = _last_attempt[key] = time.time()
    starts = backfill + catch_up

    try:
        rates = await _fetch(min(starts), wanted)
    except httpx.HTTPStatusError as exc:
        # One code the ECB doesn't publish 404s the whole request, so retry
        # each currency alone and keep whatever succeeds.
        if exc.response.status_code != 404 or len(wanted) == 1:
            log.warning("FX fetch failed: %s", exc)
            return table
        rates = {}
        for c in wanted:
            try:
                for d, by_cur in (await _fetch(min(starts), [c])).items():
                    rates.setdefault(d, {}).update(by_cur)
            except Exception as one:
                log.warning("FX fetch failed for %s: %s", c, one)
    except Exception as exc:  # network, timeout, bad JSON — fall back to stored
        log.warning("FX fetch failed: %s", exc)
        return table

    rows = [(d, c, float(v)) for d, by_cur in rates.items() for c, v in by_cur.items()]
    if rows:
        await db.executemany(
            "INSERT INTO fx_daily (date, currency, rate) VALUES (?,?,?) "
            "ON CONFLICT(date, currency) DO UPDATE SET rate = excluded.rate",
            rows,
        )
        await db.commit()
    return await load(db)


def reset_throttle():
    """For tests."""
    _last_attempt.clear()
