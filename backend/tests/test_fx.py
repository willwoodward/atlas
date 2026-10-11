"""Exchange rates: lookups, conversion, and the display-currency endpoints."""
import pytest

import fx
from conftest import FX_CALLS


def table():
    return fx.FxTable([("2026-04-02", "GBP", 0.80), ("2026-04-03", "GBP", 0.90), ("2026-04-03", "USD", 1.1)])


def test_weekend_uses_last_published_rate():
    t = table()
    assert t.rate("GBP", "2026-04-04") == 0.90   # Saturday → Friday
    assert t.rate("GBP", "2026-04-02") == 0.80
    assert t.rate("GBP", "2020-01-01") == 0.80   # before the series: earliest
    assert t.rate("GBP") == 0.90                 # latest
    assert t.rate("EUR", "2026-04-02") == 1.0


def test_converts_through_eur():
    t = table()
    assert t.convert(90, "GBP", "EUR", "2026-04-03") == pytest.approx(100)
    assert t.convert(100, "EUR", "GBP", "2026-04-02") == pytest.approx(80)
    assert t.convert(90, "GBP", "USD", "2026-04-03") == pytest.approx(110)
    assert t.convert(5, "GBP", "GBP") == 5


def test_unknown_currency_raises():
    with pytest.raises(fx.NoRate):
        table().rate("XYZ")


async def _ledger(client, auth):
    await client.post("/api/finances/accounts", headers=auth,
                      json={"id": "eur", "name": "Wise", "currency": "EUR", "balance": 1000})
    await client.post("/api/finances/accounts", headers=auth,
                      json={"id": "gbp", "name": "Barclays", "currency": "GBP", "balance": 900})
    for i, (amount, cur, date_) in enumerate([(80, "GBP", "2026-03-02"), (90, "GBP", "2026-04-02"), (50, "EUR", "2026-04-02")]):
        await client.post("/api/finances/transactions", headers=auth, json={
            "id": f"t{i}", "merchant": "Shop", "category": "Food", "amount": amount,
            "date": date_, "type": "expense", "currency": cur})


async def test_fx_endpoint_serves_rates_for_currencies_in_use(client, auth):
    await _ledger(client, auth)
    body = (await client.get("/api/finances/fx", headers=auth)).json()
    assert body["base"] == "EUR"
    assert "GBP" in body["rates"] and body["missing"] == []
    # Fetched back to the oldest transaction, so old rows convert at their own rate.
    assert min(d for d, _ in body["rates"]["GBP"]) <= "2026-03-02"


async def test_rates_are_cached_not_refetched(client, auth):
    await _ledger(client, auth)
    await client.get("/api/finances/fx", headers=auth)
    calls = len(FX_CALLS)
    await client.get("/api/finances/fx", headers=auth)
    assert len(FX_CALLS) == calls


async def test_insights_convert_each_transaction_at_its_own_date(client, auth):
    await _ledger(client, auth)
    eur = (await client.get("/api/finances/insights?month=2026-04&currency=EUR", headers=auth)).json()
    # £90 on 2 Apr at 0.90 = €100, plus €50
    assert eur["surplus"]["spending"] == pytest.approx(150)
    gbp = (await client.get("/api/finances/insights?month=2026-04&currency=GBP", headers=auth)).json()
    assert gbp["surplus"]["spending"] == pytest.approx(90 + 45)
    march = (await client.get("/api/finances/insights?month=2026-03&currency=EUR", headers=auth)).json()
    assert march["surplus"]["spending"] == pytest.approx(100)  # £80 at March's 0.80


async def test_budget_in_another_currency_is_converted(client, auth):
    await client.post("/api/finances/budgets", headers=auth,
                      json={"id": "b1", "category": "Food", "amount": 90, "currency": "GBP"})
    body = (await client.get("/api/finances/insights?currency=EUR", headers=auth)).json()
    budget = body["budgets"][0]
    assert budget["amount"] == pytest.approx(100)   # latest rate 0.90
    assert budget["native_amount"] == 90 and budget["currency"] == "GBP"


async def test_display_currency_is_validated(client, auth):
    resp = await client.get("/api/finances/insights?currency=JPY", headers=auth)
    assert resp.status_code == 400


async def test_allocation_deposits_land_in_the_pots_currency(client, auth):
    await client.post("/api/finances/pots", headers=auth,
                      json={"id": "p1", "name": "Trip", "color": "#000", "target_amount": 900, "currency": "GBP"})
    await client.post("/api/finances/allocate", headers=auth,
                      json={"allocations": [{"pot_id": "p1", "amount": 100}], "currency": "EUR"})
    pots = (await client.get("/api/finances", headers=auth)).json()["pots"]
    assert pots[0]["deposits"][0]["amount"] == pytest.approx(90)


async def test_account_currency_can_be_corrected(client, auth):
    await client.post("/api/finances/accounts", headers=auth, json={"id": "a", "name": "Wise"})
    accts = (await client.get("/api/finances", headers=auth)).json()["accounts"]
    assert accts[0]["currency"] == "EUR"   # new accounts default to EUR
    await client.patch("/api/finances/accounts/a", headers=auth, json={"currency": "gbp"})
    accts = (await client.get("/api/finances", headers=auth)).json()["accounts"]
    assert accts[0]["currency"] == "GBP"
