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


def test_wise_refund_sharing_charge_id_is_kept():
    """Wise files a card refund under the original charge's ID."""
    csv_ = """TransferWise ID,Date,Amount,Currency,Description,Merchant
CARD-1,02-10-2025,-1.80,EUR,Card transaction,Vending
CARD-1,07-10-2025,1.80,EUR,Card transaction,Vending
"""
    rows = fi.parse_statement(csv_, "wise_csv", "a")
    assert len({r.external_id for r in rows}) == 2
    assert {r.type for r in rows} == {"income", "expense"}


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
    assert spotify.external_id == "wise:TW-1:out"


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

@pytest.fixture
async def accounts(client, auth):
    """acc1 is a GBP current account (Barclays), acc2 an EUR one (Wise)."""
    for id_, cur in [("acc1", "GBP"), ("acc2", "EUR")]:
        await client.post("/api/finances/accounts", headers=auth,
                          json={"id": id_, "name": id_, "currency": cur})


async def test_preview_writes_nothing(client, auth, accounts):
    resp = await client.post("/api/finances/import/preview",
                             json={"source": "barclays_csv", "account_id": "acc1", "content": BARCLAYS},
                             headers=auth)
    assert resp.status_code == 200
    assert resp.json()["new_count"] == 3

    after = await client.get("/api/finances", headers=auth)
    assert after.json()["transactions"] == []


async def test_commit_then_reimport_is_idempotent(client, auth, accounts):
    body = {"source": "barclays_csv", "account_id": "acc1", "content": BARCLAYS}

    preview = (await client.post("/api/finances/import/preview", json=body, headers=auth)).json()
    commit = {"source": "barclays_csv", "account_id": "acc1",
              "rows": [r for r in preview["rows"] if not r["duplicate"]], "fx_rates": {}}
    first = (await client.post("/api/finances/import/commit", json=commit, headers=auth)).json()
    assert first["inserted"] == 3

    # The same export again — the common case when exporting by date range.
    second_preview = (await client.post("/api/finances/import/preview", json=body, headers=auth)).json()
    assert second_preview["duplicate_count"] == 3
    # Resend the full set: the server must still ignore what it already has.
    second = (await client.post("/api/finances/import/commit", json=commit, headers=auth)).json()
    assert second["inserted"] == 0 and second["skipped"] == 3

    txns = (await client.get("/api/finances", headers=auth)).json()["transactions"]
    assert len(txns) == 3


async def test_rows_are_stored_in_the_account_currency(client, auth, accounts):
    """A GBP row imported into the EUR account is converted at the ECB rate for
    its own date (a Saturday, so Friday's rate) and keeps its original amount."""
    body = {"source": "wise_csv", "account_id": "acc2", "content": WISE}
    preview = (await client.post("/api/finances/import/preview", json=body, headers=auth)).json()
    assert preview["account_currency"] == "EUR"
    assert preview["currencies"] == ["GBP"]
    acme = next(r for r in preview["rows"] if r["merchant"] == "ACME")
    assert acme["converted_amount"] == round(150 / 0.90, 2)

    commit = {"source": "wise_csv", "account_id": "acc2",
              "rows": [r for r in preview["rows"] if not r["duplicate"]]}
    await client.post("/api/finances/import/commit", json=commit, headers=auth)

    txns = (await client.get("/api/finances", headers=auth)).json()["transactions"]
    assert {t["currency"] for t in txns} == {"EUR"}
    received = next(t for t in txns if t["merchant"] == "ACME")
    assert received["amount"] == round(150 / 0.90, 2)
    assert (received["orig_amount"], received["orig_currency"]) == (150.0, "GBP")
    spotify = next(t for t in txns if t["merchant"] == "SPOTIFY")
    assert spotify["amount"] == 9.99 and spotify["orig_currency"] is None


async def test_unknown_currency_is_refused_not_guessed(client, auth, accounts):
    content = "TransferWise ID,Date,Amount,Currency,Description,Merchant\nX-1,03-04-2026,-5.00,XYZ,Card,Shop\n"
    resp = await client.post("/api/finances/import/preview", headers=auth,
                             json={"source": "wise_csv", "account_id": "acc2", "content": content})
    assert resp.status_code == 400
    assert "XYZ" in resp.json()["detail"]


async def test_import_needs_a_real_account(client, auth):
    resp = await client.post("/api/finances/import/preview", headers=auth,
                             json={"source": "barclays_csv", "account_id": "nope", "content": BARCLAYS})
    assert resp.status_code == 400


async def test_malformed_file_is_a_400_not_a_500(client, auth):
    resp = await client.post("/api/finances/import/preview",
                             json={"source": "barclays_csv", "account_id": "a", "content": "nonsense"},
                             headers=auth)
    assert resp.status_code == 400


async def test_rules_are_applied_during_preview(client, auth, accounts):
    await client.post("/api/finances/rules",
                      json={"id": "r1", "pattern": "tesco", "category": "Groceries"}, headers=auth)
    preview = (await client.post("/api/finances/import/preview",
                                 json={"source": "barclays_csv", "account_id": "acc1", "content": BARCLAYS},
                                 headers=auth)).json()
    tesco = next(r for r in preview["rows"] if "TESCO" in r["merchant"])
    assert tesco["category"] == "Groceries"


# ── Closing balance ───────────────────────────────────────────────────────────

WISE_BAL = """TransferWise ID,Date,Date Time,Amount,Currency,Description,Running Balance,Merchant
CARD-2,09-10-2026,09-10-2026 18:33:45.251,-11.75,EUR,Card,8070.79,Pret
CARD-1,09-10-2026,09-10-2026 12:21:44.562,-14.20,EUR,Card,8082.54,Tula
CARD-0,08-10-2026,08-10-2026 12:20:28.560,-16.00,EUR,Card,8096.74,Sumup
"""


def test_closing_balance_is_the_newest_rows_running_balance():
    rows = fi.parse_statement(WISE_BAL, "wise_csv", "a")
    assert fi.closing_balance(rows) == {"amount": 8070.79, "date": "2026-10-09", "currency": "EUR"}


def test_no_closing_balance_without_running_balances():
    assert fi.closing_balance(fi.parse_statement(BARCLAYS, "barclays_csv", "a")) is None


async def _import(client, auth, content, account="acc2", source="wise_csv"):
    body = {"source": source, "account_id": account, "content": content}
    preview = (await client.post("/api/finances/import/preview", json=body, headers=auth)).json()
    commit = {"source": source, "account_id": account, "closing_balance": preview["closing_balance"],
              "rows": [r for r in preview["rows"] if not r["duplicate"]]}
    return preview, (await client.post("/api/finances/import/commit", json=commit, headers=auth)).json()


async def _acc(client, auth, id_):
    return next(a for a in (await client.get("/api/finances", headers=auth)).json()["accounts"] if a["id"] == id_)


async def test_import_sets_the_account_balance_from_the_statement(client, auth, accounts):
    preview, result = await _import(client, auth, WISE_BAL)
    assert preview["balance_update"]["will_update"] is True
    assert result["balance_updated"]["amount"] == 8070.79
    acc = await _acc(client, auth, "acc2")
    assert (acc["balance"], acc["balance_as_of"]) == (8070.79, "2026-10-09")


async def test_an_older_statement_does_not_roll_the_balance_back(client, auth, accounts):
    await _import(client, auth, WISE_BAL)
    older = "TransferWise ID,Date,Date Time,Amount,Currency,Description,Running Balance,Merchant\nCARD-9,01-09-2026,01-09-2026 10:00:00.000,-5.00,EUR,Card,7000.00,Shop\n"
    preview, result = await _import(client, auth, older)
    assert preview["balance_update"]["will_update"] is False
    assert result["balance_updated"] is None
    assert (await _acc(client, auth, "acc2"))["balance"] == 8070.79


async def test_balance_in_another_currency_is_not_applied(client, auth, accounts):
    preview, result = await _import(client, auth, WISE_BAL, account="acc1")  # GBP account
    assert preview["balance_update"]["will_update"] is False
    assert "EUR" in preview["balance_update"]["reason"]
    assert (await _acc(client, auth, "acc1"))["balance"] == 0


async def test_editing_an_account_stamps_the_balance_date(client, auth, accounts):
    resp = await client.patch("/api/finances/accounts/acc2", headers=auth,
                              json={"name": "Wise EUR", "institution": "Wise", "type": "savings", "balance": 100})
    assert resp.status_code == 200
    acc = await _acc(client, auth, "acc2")
    assert (acc["name"], acc["institution"], acc["type"], acc["balance"]) == ("Wise EUR", "Wise", "savings", 100)
    assert acc["balance_as_of"]  # today
    bad = await client.patch("/api/finances/accounts/acc2", headers=auth, json={"type": "bogus"})
    assert bad.status_code == 400


# ── Categorising ──────────────────────────────────────────────────────────────

async def test_set_a_transactions_category(client, auth, accounts):
    await _import(client, auth, WISE_BAL)
    txns = (await client.get("/api/finances", headers=auth)).json()["transactions"]
    pret = next(t for t in txns if t["merchant"] == "Pret")
    await client.patch(f"/api/finances/transactions/{pret['id']}", headers=auth, json={"category": " Eating out "})
    txns = (await client.get("/api/finances", headers=auth)).json()["transactions"]
    assert next(t for t in txns if t["id"] == pret["id"])["category"] == "Eating out"


async def test_applying_a_rule_fills_only_uncategorised_matches(client, auth, accounts):
    for i, (m, cat) in enumerate([("TESCO STORES 1", ""), ("Tesco Express", ""), ("tesco petrol", "Car"), ("Spar", "")]):
        await client.post("/api/finances/transactions", headers=auth, json={
            "id": f"t{i}", "merchant": m, "category": cat, "amount": 5, "date": "2026-10-01", "currency": "EUR"})
    r = (await client.post("/api/finances/rules/apply", headers=auth, json={"pattern": "TESCO", "category": "Groceries"})).json()
    assert r["updated"] == 2
    cats = {t["merchant"]: t["category"] for t in (await client.get("/api/finances", headers=auth)).json()["transactions"]}
    assert cats == {"TESCO STORES 1": "Groceries", "Tesco Express": "Groceries", "tesco petrol": "Car", "Spar": ""}
    r = (await client.post("/api/finances/rules/apply", headers=auth,
                           json={"pattern": "tesco", "category": "Groceries", "overwrite": True})).json()
    assert r["updated"] == 3
    empty = await client.post("/api/finances/rules/apply", headers=auth, json={"pattern": "  ", "category": "X"})
    assert empty.status_code == 400
