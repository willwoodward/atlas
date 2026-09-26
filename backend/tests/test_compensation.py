"""
Compensation projection.

The failure mode worth guarding against is a plausible-looking wrong number:
equity valued at a stale price, an annual figure counted twelve times, or a
one-off bonus recurring forever. Each of those looks fine on a chart.
"""
from datetime import date

import pytest

import compensation as comp


BASE = {"id": "c1", "kind": "base", "label": "Base salary", "amount": 120000,
        "currency": "EUR", "cadence": "annual", "start_date": "", "end_date": ""}
ONCALL = {"id": "c2", "kind": "oncall", "label": "On-call", "amount": 400,
          "currency": "EUR", "cadence": "monthly", "start_date": "", "end_date": ""}
SIGNON = {"id": "c3", "kind": "bonus", "label": "Sign-on year 1", "amount": 20000,
          "currency": "EUR", "cadence": "one_off", "start_date": "2026-09-15", "end_date": ""}

FX = {"EUR": 0.85, "USD": 0.79, "GBP": 1.0}
PRICES = {"AMZN": {"symbol": "AMZN", "price": 200.0, "currency": "USD"}}
GRANT = {"id": "g1", "label": "2026 grant", "symbol": "AMZN", "currency": "USD", "total_units": 100}


def _project(components=(), grants=(), vests=(), **kw):
    return comp.project(list(components), list(grants), list(vests), PRICES, FX,
                        today=date(2026, 9, 1), **kw)


def test_annual_salary_is_spread_not_repeated():
    rows = _project([BASE], months=12)
    assert rows[0]["base"] == pytest.approx(120000 / 12 * 0.85, abs=0.01)
    assert sum(r["base"] for r in rows) == pytest.approx(120000 * 0.85, abs=0.5)


def test_monthly_component_repeats():
    rows = _project([ONCALL], months=3)
    assert all(r["oncall"] == pytest.approx(400 * 0.85, abs=0.01) for r in rows)


def test_one_off_lands_in_its_month_only():
    rows = _project([SIGNON], months=6)
    by_month = {r["month"]: r["bonus"] for r in rows}
    assert by_month["2026-09"] == pytest.approx(20000 * 0.85, abs=0.01)
    assert by_month["2026-10"] == 0
    assert sum(by_month.values()) == pytest.approx(20000 * 0.85, abs=0.01)


def test_component_outside_its_window_is_excluded():
    ended = {**ONCALL, "end_date": "2026-10-31"}
    rows = _project([ended], months=4)
    by_month = {r["month"]: r["oncall"] for r in rows}
    assert by_month["2026-10"] > 0
    assert by_month["2026-11"] == 0


def test_currency_is_converted_at_the_given_rate():
    gbp_base = {**BASE, "currency": "GBP"}
    eur_rows = _project([BASE], months=1)
    gbp_rows = _project([gbp_base], months=1)
    assert gbp_rows[0]["base"] == pytest.approx(eur_rows[0]["base"] / 0.85, abs=0.01)


# ── Equity ────────────────────────────────────────────────────────────────────

def test_vest_is_valued_in_units_times_price_times_fx():
    vests = [{"id": "v1", "grant_id": "g1", "vest_date": "2026-11-20", "units": 10}]
    rows = _project([], [GRANT], vests, months=6)
    nov = next(r for r in rows if r["month"] == "2026-11")
    assert nov["equity"] == pytest.approx(10 * 200.0 * 0.79, abs=0.01)


def test_vest_outside_the_window_is_not_counted():
    vests = [{"id": "v1", "grant_id": "g1", "vest_date": "2028-05-20", "units": 10}]
    rows = _project([], [GRANT], vests, months=12)
    assert sum(r["equity"] for r in rows) == 0


def test_vest_with_no_known_price_is_zero_not_a_crash():
    """An unpriced symbol should read as zero, which is visibly wrong, rather
    than inventing a value."""
    grant = {**GRANT, "symbol": "UNKNOWN"}
    vests = [{"id": "v1", "grant_id": "g1", "vest_date": "2026-11-20", "units": 10}]
    rows = _project([], [grant], vests, months=6)
    assert sum(r["equity"] for r in rows) == 0


def test_unvested_units_counts_only_the_future():
    vests = [
        {"id": "v1", "grant_id": "g1", "vest_date": "2026-05-01", "units": 5},
        {"id": "v2", "grant_id": "g1", "vest_date": "2027-05-01", "units": 15},
    ]
    remaining = comp.unvested_units([GRANT], vests, today=date(2026, 9, 1))
    assert remaining["g1"] == 15


# ── Net ───────────────────────────────────────────────────────────────────────

def test_tax_rate_is_a_flat_haircut_on_gross():
    rows = _project([BASE], months=1, tax_rate=0.4)
    assert rows[0]["net"] == pytest.approx(rows[0]["gross"] * 0.6, abs=0.01)


def test_zero_tax_rate_leaves_net_equal_to_gross():
    rows = _project([BASE], months=1)
    assert rows[0]["net"] == rows[0]["gross"]


def test_summary_totals_the_projection():
    rows = _project([BASE, ONCALL], months=12, tax_rate=0.4)
    s = comp.summarise(rows)
    assert s["gross_12m"] == pytest.approx(sum(r["gross"] for r in rows), abs=0.01)
    assert s["avg_monthly_gross"] == pytest.approx(s["gross_12m"] / 12, abs=0.01)


def test_month_range_rolls_over_the_year():
    assert comp.month_range(date(2026, 11, 1), 4) == ["2026-11", "2026-12", "2027-01", "2027-02"]


# ── API ───────────────────────────────────────────────────────────────────────

async def test_employment_round_trip(client, auth):
    await client.post("/api/employment", json={
        "id": "e1", "employer": "AWS", "title": "SDE", "location": "Dublin",
        "currency": "EUR", "start_date": "2026-01-06", "effective_tax_rate": 0.42,
    }, headers=auth)
    await client.put("/api/employment/fx", json={"currency": "EUR", "rate_to_gbp": 0.85}, headers=auth)
    await client.post("/api/employment/e1/components", json={
        "id": "c1", "kind": "base", "label": "Base", "amount": 120000,
        "currency": "EUR", "cadence": "annual",
    }, headers=auth)

    data = (await client.get("/api/employment", headers=auth)).json()
    assert data["employments"][0]["employer"] == "AWS"
    assert len(data["projection"]) == 12
    assert data["summary"]["gross_12m"] == pytest.approx(120000 * 0.85, abs=1)
    assert data["summary"]["net_12m"] == pytest.approx(120000 * 0.85 * 0.58, abs=1)


async def test_grant_and_vests_round_trip(client, auth):
    await client.post("/api/employment", json={"id": "e1", "employer": "AWS"}, headers=auth)
    await client.put("/api/employment/prices",
                     json={"symbol": "AMZN", "price": 200, "currency": "USD"}, headers=auth)
    await client.put("/api/employment/fx",
                     json={"currency": "USD", "rate_to_gbp": 0.79}, headers=auth)
    await client.post("/api/employment/e1/grants", json={
        "id": "g1", "label": "2026 grant", "total_units": 100, "symbol": "AMZN",
    }, headers=auth)
    await client.post("/api/employment/grants/g1/vests",
                      json={"id": "v1", "vest_date": "2099-01-15", "units": 20}, headers=auth)

    data = (await client.get("/api/employment", headers=auth)).json()
    grant = data["grants"][0]
    assert grant["unvested_units"] == 20
    assert len(grant["vests"]) == 1


async def test_invalid_kind_is_rejected(client, auth):
    await client.post("/api/employment", json={"id": "e1", "employer": "AWS"}, headers=auth)
    resp = await client.post("/api/employment/e1/components", json={
        "id": "c1", "kind": "nonsense", "label": "X", "amount": 1, "cadence": "annual",
    }, headers=auth)
    assert resp.status_code == 400


async def test_one_off_without_a_date_is_rejected(client, auth):
    await client.post("/api/employment", json={"id": "e1", "employer": "AWS"}, headers=auth)
    resp = await client.post("/api/employment/e1/components", json={
        "id": "c1", "kind": "bonus", "label": "Sign-on", "amount": 20000, "cadence": "one_off",
    }, headers=auth)
    assert resp.status_code == 400


async def test_deleting_employment_removes_its_children(client, auth):
    await client.post("/api/employment", json={"id": "e1", "employer": "AWS"}, headers=auth)
    await client.post("/api/employment/e1/components", json={
        "id": "c1", "kind": "base", "label": "Base", "amount": 1, "cadence": "annual",
    }, headers=auth)
    await client.post("/api/employment/e1/grants", json={"id": "g1", "label": "G", "total_units": 1}, headers=auth)
    await client.post("/api/employment/grants/g1/vests",
                      json={"id": "v1", "vest_date": "2099-01-15", "units": 1}, headers=auth)

    await client.delete("/api/employment/e1", headers=auth)
    data = (await client.get("/api/employment", headers=auth)).json()
    assert data["employments"] == [] and data["components"] == [] and data["grants"] == []
