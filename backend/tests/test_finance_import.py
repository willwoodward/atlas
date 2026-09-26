"""
Statement import.

The risk this pipeline carries is silent corruption: a misread date or a missed
duplicate does not raise, it just leaves the ledger quietly wrong. So these
tests concentrate on the parsing edges and on idempotency rather than on the
happy path.
"""
import pytest

import finance_import as fi


BARCLAYS = """Number,Date,Account,Amount,Subcategory,Memo
1,03/04/2026,20-00-00 12345678,-12.50,Groceries,TESCO STORES 3421
2,04/04/2026,20-00-00 12345678,2500.00,Salary,ACME LTD SALARY
3,05/04/2026,20-00-00 12345678,"-1,250.00",Rent,LANDLORD RENT
"""

WISE = """TransferWise ID,Date,Amount,Currency,Description,Payment Reference,Merchant
TW-1,03-04-2026,-9.99,EUR,Card transaction,,SPOTIFY
TW-2,04-04-2026,150.00,GBP,Received money,,ACME
"""


# ── Parsing ───────────────────────────────────────────────────────────────────

def test_barclays_signed_amount_becomes_type():
    rows = fi.parse_statement(BARCLAYS, "barclays_csv", "acc1")
    by_merchant = {r.merchant: r for r in rows}
    assert by_merchant["TESCO STORES 3421"].type == "expense"
    assert by_merchant["TESCO STORES 3421"].amount == 12.50
    assert by_merchant["ACME LTD SALARY"].type == "income"
    assert by_merchant["ACME LTD SALARY"].amount == 2500.00


def test_thousands_separator_is_parsed():
    rows = fi.parse_statement(BARCLAYS, "barclays_csv", "acc1")
    rent = next(r for r in rows if r.merchant == "LANDLORD RENT")
    assert rent.amount == 1250.00


def test_uk_dates_are_day_first():
    """03/04/2026 is 3 April, not 3 March — getting this backwards would
    scramble every ambiguous date in the file without erroring."""
    rows = fi.parse_statement(BARCLAYS, "barclays_csv", "acc1")
    assert any(r.date == "2026-04-03" for r in rows)
    assert not any(r.date == "2026-03-04" for r in rows)


def test_wise_keeps_currency_and_uses_provider_id():
    rows = fi.parse_statement(WISE, "wise_csv", "acc2")
    spotify = next(r for r in rows if r.merchant == "SPOTIFY")
    assert spotify.currency == "EUR"
    assert spotify.external_id == "wise:TW-1"


def test_unparseable_date_is_reported_not_guessed():
    bad = "Number,Date,Amount,Memo\n1,not-a-date,-1.00,X\n"
    with pytest.raises(fi.ImportError_):
        fi.parse_statement(bad, "barclays_csv", "acc1")


def test_unknown_source_rejected():
    with pytest.raises(fi.ImportError_):
        fi.parse_statement(BARCLAYS, "monzo_csv", "acc1")


# ── Dedupe ────────────────────────────────────────────────────────────────────

def test_content_ids_are_stable_across_reparse():
    a = fi.parse_statement(BARCLAYS, "barclays_csv", "acc1")
    b = fi.parse_statement(BARCLAYS, "barclays_csv", "acc1")
    assert [r.external_id for r in a] == [r.external_id for r in b]


def test_same_statement_different_account_gets_different_ids():
    a = fi.parse_statement(BARCLAYS, "barclays_csv", "acc1")
    b = fi.parse_statement(BARCLAYS, "barclays_csv", "acc2")
    assert set(r.external_id for r in a).isdisjoint(r.external_id for r in b)


def test_identical_repeated_purchases_stay_distinct():
    """Two identical coffees on one day are two transactions, not one."""
    csv_text = ("Number,Date,Amount,Memo\n"
                "1,03/04/2026,-3.00,COFFEE\n"
                "2,03/04/2026,-3.00,COFFEE\n")
    rows = fi.parse_statement(csv_text, "barclays_csv", "acc1")
    assert len(rows) == 2
    assert rows[0].external_id != rows[1].external_id


# ── Rules ─────────────────────────────────────────────────────────────────────

def test_first_matching_rule_wins():
    rules = [{"pattern": "tesco", "category": "Groceries"},
             {"pattern": "tes", "category": "Wrong"}]
    rows = fi.parse_statement(BARCLAYS, "barclays_csv", "acc1", rules)
    tesco = next(r for r in rows if "TESCO" in r.merchant)
    assert tesco.category == "Groceries"


def test_rules_are_case_insensitive_and_optional():
    rows = fi.parse_statement(BARCLAYS, "barclays_csv", "acc1",
                              [{"pattern": "LANDLORD", "category": "Rent"}])
    assert next(r for r in rows if "LANDLORD" in r.merchant).category == "Rent"
    assert next(r for r in rows if "TESCO" in r.merchant).category == ""


# ── API ───────────────────────────────────────────────────────────────────────

async def test_preview_writes_nothing(client, auth):
    resp = await client.post("/api/finances/import/preview",
                             json={"source": "barclays_csv", "account_id": "acc1", "content": BARCLAYS},
                             headers=auth)
    assert resp.status_code == 200
    assert resp.json()["new_count"] == 3

    after = await client.get("/api/finances", headers=auth)
    assert after.json()["transactions"] == []


async def test_commit_then_reimport_is_idempotent(client, auth):
    body = {"source": "barclays_csv", "account_id": "acc1", "content": BARCLAYS}

    preview = (await client.post("/api/finances/import/preview", json=body, headers=auth)).json()
    commit = {"source": "barclays_csv", "account_id": "acc1",
              "rows": [dict(r, id="") for r in preview["rows"]], "fx_rates": {}}
    first = (await client.post("/api/finances/import/commit", json=commit, headers=auth)).json()
    assert first["inserted"] == 3

    # The same export again — the common case when exporting by date range.
    second_preview = (await client.post("/api/finances/import/preview", json=body, headers=auth)).json()
    assert second_preview["duplicate_count"] == 3
    second = (await client.post("/api/finances/import/commit", json=commit, headers=auth)).json()
    assert second["inserted"] == 0 and second["skipped"] == 3

    txns = (await client.get("/api/finances", headers=auth)).json()["transactions"]
    assert len(txns) == 3


async def test_commit_applies_fx_rate_for_non_gbp(client, auth):
    body = {"source": "wise_csv", "account_id": "acc2", "content": WISE}
    preview = (await client.post("/api/finances/import/preview", json=body, headers=auth)).json()
    assert preview["currencies"] == ["EUR"]

    commit = {"source": "wise_csv", "account_id": "acc2",
              "rows": [dict(r, id="") for r in preview["rows"]], "fx_rates": {"EUR": 0.85}}
    await client.post("/api/finances/import/commit", json=commit, headers=auth)

    txns = (await client.get("/api/finances", headers=auth)).json()["transactions"]
    eur = next(t for t in txns if t["currency"] == "EUR")
    gbp = next(t for t in txns if t["currency"] == "GBP")
    assert eur["fx_rate"] == 0.85
    assert gbp["fx_rate"] == 1.0   # a rate is never applied to the base currency


async def test_malformed_file_is_a_400_not_a_500(client, auth):
    resp = await client.post("/api/finances/import/preview",
                             json={"source": "barclays_csv", "account_id": "a", "content": "nonsense"},
                             headers=auth)
    assert resp.status_code == 400


async def test_rules_are_applied_during_preview(client, auth):
    await client.post("/api/finances/rules",
                      json={"id": "r1", "pattern": "tesco", "category": "Groceries"}, headers=auth)
    preview = (await client.post("/api/finances/import/preview",
                                 json={"source": "barclays_csv", "account_id": "acc1", "content": BARCLAYS},
                                 headers=auth)).json()
    tesco = next(r for r in preview["rows"] if "TESCO" in r["merchant"])
    assert tesco["category"] == "Groceries"
