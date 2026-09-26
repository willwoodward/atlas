"""
Budgets, recurring detection, and surplus allocation.

Recurring detection is the part that can be confidently wrong, so most of these
tests are about what it must *refuse* to call a subscription. A false positive
here tells you that you have a £4.29/month sandwich contract.
"""
from datetime import date, timedelta

import pytest

import finance_insights as fi


def txn(merchant, amount, day, type="expense", category="", fx_rate=1.0):
    return {"merchant": merchant, "amount": amount, "date": day,
            "type": type, "category": category, "fx_rate": fx_rate}


def monthly(merchant, amount, months, start=(2026, 1, 12), **kw):
    y, m, d = start
    out = []
    for i in range(months):
        mo = m + i
        out.append(txn(merchant, amount, f"{y + (mo - 1) // 12}-{(mo - 1) % 12 + 1:02d}-{d:02d}", **kw))
    return out


# ── Merchant normalisation ────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("SPOTIFY 4829", "SPOTIFY"),
    ("NETFLIX.COM ON 03 APR", "NETFLIX.COM"),
    ("TESCO STORES 3421", "TESCO STORES"),
    ("  Amazon   Prime  ", "AMAZON PRIME"),
])
def test_normalise_strips_reference_noise(raw, expected):
    assert fi.normalise_merchant(raw) == expected


def test_normalisation_keeps_distinct_merchants_apart():
    """Over-merging is worse than under-merging — it invents subscriptions."""
    assert fi.normalise_merchant("TESCO STORES") != fi.normalise_merchant("TESCO PETROL")


# ── Recurring detection ───────────────────────────────────────────────────────

def test_monthly_subscription_is_detected():
    rows = monthly("SPOTIFY 4829", 11.99, 6)
    found = fi.find_recurring(rows, today=date(2026, 7, 1))
    assert len(found) == 1
    assert found[0]["cadence"] == "monthly"
    assert found[0]["amount"] == 11.99
    assert found[0]["annualised"] == pytest.approx(11.99 * 12, abs=1)


def test_two_occurrences_are_not_enough():
    """Any two dates define a cadence. Three is the floor for a claim."""
    rows = monthly("SPOTIFY", 11.99, 2)
    assert fi.find_recurring(rows, today=date(2026, 3, 1)) == []


def test_irregular_spending_is_not_a_subscription():
    """Coffee bought at random is habit, not billing."""
    rows = [txn("PRET A MANGER", 3.20, d) for d in
            ["2026-01-03", "2026-01-05", "2026-02-19", "2026-03-02", "2026-03-04"]]
    assert fi.find_recurring(rows, today=date(2026, 4, 1)) == []


def test_income_is_never_reported_as_recurring_spend():
    rows = monthly("AWS PAYROLL", 3120.0, 6, type="income")
    assert fi.find_recurring(rows, today=date(2026, 7, 1)) == []


def test_weekly_and_annual_cadences_are_recognised():
    weekly = [txn("GYM", 9.0, (date(2026, 1, 5) + timedelta(days=7 * i)).isoformat()) for i in range(6)]
    assert fi.find_recurring(weekly, today=date(2026, 3, 1))[0]["cadence"] == "weekly"

    annual = [txn("INSURANCE", 240.0, f"{y}-03-01") for y in (2023, 2024, 2025, 2026)]
    assert fi.find_recurring(annual, today=date(2026, 4, 1))[0]["cadence"] == "annual"


def test_variable_amounts_are_flagged_not_hidden():
    """A utility bill still recurs — it just isn't a fixed number."""
    rows = monthly("ENERGY CO", 0, 5)
    for r, amt in zip(rows, [82.10, 95.40, 71.20, 110.05, 88.00]):
        r["amount"] = amt
    found = fi.find_recurring(rows, today=date(2026, 6, 1))
    assert found and found[0]["varies"] is True


def test_stopped_subscription_is_flagged_overdue():
    rows = monthly("OLD SERVICE", 8.0, 4)          # Jan–Apr 2026
    found = fi.find_recurring(rows, today=date(2026, 9, 1))
    assert found[0]["overdue"] is True


def test_next_due_follows_the_last_payment():
    rows = monthly("SPOTIFY", 11.99, 4)            # last 2026-04-12
    found = fi.find_recurring(rows, today=date(2026, 5, 1))
    assert found[0]["next_due"].startswith("2026-05")
    assert found[0]["overdue"] is False


def test_foreign_currency_is_compared_in_gbp():
    rows = monthly("SPOTIFY EU", 10.0, 4, fx_rate=0.85)
    found = fi.find_recurring(rows, today=date(2026, 5, 1))
    assert found[0]["amount"] == pytest.approx(8.50, abs=0.01)


# ── Budgets ───────────────────────────────────────────────────────────────────

def test_budget_tracks_spend_and_flags_overspend():
    budgets = [{"id": "b1", "category": "Groceries", "amount": 400}]
    rows = [txn("TESCO", 250, "2026-04-03", category="Groceries"),
            txn("ALDI", 200, "2026-04-20", category="Groceries")]
    status, _ = fi.budget_status(budgets, rows, month="2026-04", today=date(2026, 4, 30))
    assert status[0]["spent"] == 450
    assert status[0]["remaining"] == -50
    assert status[0]["over"] is True


def test_pace_distinguishes_early_from_late_spending():
    """£90 of £100 is fine on the 28th and alarming on the 3rd."""
    budgets = [{"id": "b1", "category": "Groceries", "amount": 100}]
    rows = [txn("TESCO", 90, "2026-04-03", category="Groceries")]
    early, _ = fi.budget_status(budgets, rows, month="2026-04", today=date(2026, 4, 3))
    late, _ = fi.budget_status(budgets, rows, month="2026-04", today=date(2026, 4, 28))
    assert early[0]["pace"] > 5
    assert late[0]["pace"] < 1.1


def test_other_months_do_not_leak_in():
    budgets = [{"id": "b1", "category": "Groceries", "amount": 400}]
    rows = [txn("TESCO", 250, "2026-03-31", category="Groceries"),
            txn("TESCO", 100, "2026-04-01", category="Groceries")]
    status, _ = fi.budget_status(budgets, rows, month="2026-04", today=date(2026, 4, 30))
    assert status[0]["spent"] == 100


def test_spending_outside_any_budget_is_reported():
    """The blind spot a budget page otherwise creates."""
    budgets = [{"id": "b1", "category": "Groceries", "amount": 400}]
    rows = [txn("TESCO", 100, "2026-04-02", category="Groceries"),
            txn("STEAM", 60, "2026-04-05", category="Games"),
            txn("UNKNOWN", 20, "2026-04-06")]
    _, unbudgeted = fi.budget_status(budgets, rows, month="2026-04", today=date(2026, 4, 30))
    cats = {u["category"]: u["spent"] for u in unbudgeted}
    assert cats == {"Games": 60, "Uncategorised": 20}


# ── Surplus ───────────────────────────────────────────────────────────────────

def test_surplus_is_income_minus_spending_for_the_month():
    rows = [txn("PAYROLL", 3000, "2026-04-28", type="income"),
            txn("RENT", 1450, "2026-04-25"),
            txn("OLD", 999, "2026-03-01")]
    s = fi.surplus_for(rows, month="2026-04")
    assert s["surplus"] == 1550


def test_allocation_is_proportional_to_shortfall():
    pots = [{"id": "p1", "name": "Camera", "target_amount": 1000, "saved": 900},
            {"id": "p2", "name": "Trip", "target_amount": 2000, "saved": 1000}]
    out = fi.suggest_allocation(600, pots)
    by_id = {a["pot_id"]: a["suggested"] for a in out}
    # Shortfalls are 100 and 1000 → the nearly-finished pot does not soak it up.
    assert by_id["p1"] == pytest.approx(54.55, abs=0.01)
    assert by_id["p2"] == pytest.approx(545.45, abs=0.01)


def test_allocation_never_exceeds_what_a_pot_needs():
    pots = [{"id": "p1", "name": "Camera", "target_amount": 1000, "saved": 950}]
    assert fi.suggest_allocation(500, pots)[0]["suggested"] == 50


def test_no_suggestion_when_there_is_no_surplus():
    pots = [{"id": "p1", "target_amount": 1000, "saved": 0}]
    assert fi.suggest_allocation(-200, pots) == []
    assert fi.suggest_allocation(0, pots) == []


def test_completed_pots_are_skipped():
    pots = [{"id": "p1", "target_amount": 1000, "saved": 1000}]
    assert fi.suggest_allocation(500, pots) == []


# ── API ───────────────────────────────────────────────────────────────────────

async def test_insights_endpoint(client, auth):
    for i, m in enumerate(["01", "02", "03"]):
        await client.post("/api/finances/transactions", json={
            "id": f"s{i}", "merchant": "SPOTIFY 4829", "category": "Subscriptions",
            "amount": 11.99, "date": f"2026-{m}-12", "type": "expense",
        }, headers=auth)
    await client.post("/api/finances/budgets",
                      json={"id": "b1", "category": "Subscriptions", "amount": 30}, headers=auth)

    data = (await client.get("/api/finances/insights?month=2026-03", headers=auth)).json()
    assert data["budgets"][0]["spent"] == 11.99
    assert data["recurring"][0]["cadence"] == "monthly"


async def test_allocate_creates_deposits_only_when_asked(client, auth):
    await client.post("/api/finances/pots", json={
        "id": "p1", "name": "Camera", "color": "#6f8168", "target_amount": 1000, "notes": "",
    }, headers=auth)
    await client.post("/api/finances/transactions", json={
        "id": "i1", "merchant": "PAYROLL", "amount": 2000,
        "date": "2026-04-28", "type": "income",
    }, headers=auth)

    insights = (await client.get("/api/finances/insights?month=2026-04", headers=auth)).json()
    assert insights["allocation"][0]["pot_id"] == "p1"

    # Suggesting must not have written anything.
    pots = (await client.get("/api/finances", headers=auth)).json()["pots"]
    assert pots[0]["deposits"] == []

    await client.post("/api/finances/allocate", json={
        "allocations": [{"pot_id": "p1", "amount": 300}], "note": "April surplus",
    }, headers=auth)
    pots = (await client.get("/api/finances", headers=auth)).json()["pots"]
    assert len(pots[0]["deposits"]) == 1
    assert pots[0]["deposits"][0]["amount"] == 300


async def test_budget_upsert_is_keyed_on_category(client, auth):
    await client.post("/api/finances/budgets", json={"id": "b1", "category": "Food", "amount": 100}, headers=auth)
    await client.post("/api/finances/budgets", json={"id": "b2", "category": "Food", "amount": 250}, headers=auth)
    data = (await client.get("/api/finances/insights", headers=auth)).json()
    assert len(data["budgets"]) == 1
    assert data["budgets"][0]["amount"] == 250
