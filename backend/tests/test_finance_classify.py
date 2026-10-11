"""Auto-categorising: what's sent, what comes back, and what it may overwrite."""
import pytest

import finance_classify

WISE = """TransferWise ID,Date,Date Time,Amount,Currency,Description,Running Balance,Merchant
C-1,09-10-2026,09-10-2026 18:33:45.251,-11.75,EUR,Card,100.00,Pret A Manger DUBLIN
C-2,09-10-2026,09-10-2026 12:21:44.562,-14.20,EUR,Card,111.75,Pret A Manger DUBLIN
C-3,08-10-2026,08-10-2026 12:20:28.560,-16.00,EUR,Card,125.95,Mystery Ltd
T-1,07-10-2026,07-10-2026 10:00:00.000,200.00,EUR,Topped up account,141.95,
C-4,06-10-2026,06-10-2026 10:00:00.000,-30.00,EUR,Card,-58.05,Tesco Stores
"""


@pytest.fixture
def model(monkeypatch):
    """A fake model: records what it was sent, answers from a lookup."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    sent = []
    answers = {"Pret A Manger DUBLIN": "Eating out", "Topped up account": "Transfer",
               "Tesco Stores": "Groceries", "Mystery Ltd": ""}

    async def fake(items, categories):
        sent.append({"items": items, "categories": categories})
        return {it["id"]: answers.get(it["merchant"], "") for it in items}

    monkeypatch.setattr(finance_classify, "_call_model", fake)
    return sent


async def _setup(client, auth, rule=None):
    await client.post("/api/finances/accounts", headers=auth, json={"id": "w", "name": "Wise", "currency": "EUR"})
    if rule:
        await client.post("/api/finances/rules", headers=auth, json={"id": "r", **rule})
    body = {"source": "wise_csv", "account_id": "w", "content": WISE}
    preview = (await client.post("/api/finances/import/preview", json=body, headers=auth)).json()
    commit = {"source": "wise_csv", "account_id": "w", "rows": preview["rows"]}
    return (await client.post("/api/finances/import/commit", json=commit, headers=auth)).json()


async def _cats(client, auth):
    return {t["merchant"]: (t["category"], t["category_source"])
            for t in (await client.get("/api/finances", headers=auth)).json()["transactions"]}


async def test_import_categorises_what_rules_left(client, auth, model):
    result = await _setup(client, auth, rule={"pattern": "tesco", "category": "Food shop"})
    assert result["auto_categorised"] == 3 and result["auto_error"] is None
    cats = await _cats(client, auth)
    assert cats["Tesco Stores"] == ("Food shop", "rule")          # the rule won, model not asked
    assert cats["Pret A Manger DUBLIN"] == ("Eating out", "ai")
    assert cats["Topped up account"] == ("Transfer", "ai")
    assert cats["Mystery Ltd"] == ("", "")                        # unsure stays blank


async def test_only_distinct_merchant_and_direction_are_sent(client, auth, model):
    await _setup(client, auth)
    items = [it for call in model for it in call["items"]]
    assert sorted((i["merchant"], i["direction"]) for i in items) == sorted([
        ("Pret A Manger DUBLIN", "out"), ("Mystery Ltd", "out"), ("Topped up account", "in"), ("Tesco Stores", "out")])
    assert all(set(i) == {"id", "merchant", "direction"} for i in items)   # no amounts or dates


async def test_your_categories_lead_the_allowed_list(client, auth, model):
    await client.post("/api/finances/transactions", headers=auth, json={
        "id": "m", "merchant": "Landlord", "category": "Rent & bills", "amount": 900, "date": "2026-10-01", "currency": "EUR"})
    await _setup(client, auth)
    cats = model[0]["categories"]
    assert cats[0] == "Rent & bills" and "Groceries" in cats


async def test_model_answers_outside_the_list_are_ignored(client, auth, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "k")

    async def rogue(items, categories):
        return {it["id"]: "Made Up Category" for it in items}
    monkeypatch.setattr(finance_classify, "_call_model", rogue)
    result = await _setup(client, auth)
    assert result["auto_categorised"] == 0


async def test_a_failing_model_never_fails_the_import(client, auth, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "k")

    async def broken(items, categories):
        raise finance_classify.ClassifyError("The model request failed (500)")
    monkeypatch.setattr(finance_classify, "_call_model", broken)
    result = await _setup(client, auth)
    assert result["inserted"] == 5 and "500" in result["auto_error"]


async def test_no_key_means_no_call(client, auth, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    result = await _setup(client, auth)
    assert result["auto_categorised"] == 0 and result["auto_error"] is None
    assert (await client.post("/api/finances/classify", headers=auth)).status_code == 400
    assert (await client.get("/api/finances/classify/status", headers=auth)).json()["configured"] is False


async def test_rules_and_edits_replace_ai_guesses_but_rules_never_replace_edits(client, auth, model):
    await _setup(client, auth)
    txns = (await client.get("/api/finances", headers=auth)).json()["transactions"]
    pret = [t for t in txns if t["merchant"].startswith("Pret")]
    # You correct one Pret by hand…
    await client.patch(f"/api/finances/transactions/{pret[0]['id']}", headers=auth, json={"category": "Lunch"})
    # …then make a rule for Pret: it replaces the remaining AI guess, not your edit.
    r = (await client.post("/api/finances/rules/apply", headers=auth, json={"pattern": "pret", "category": "Coffee"})).json()
    assert r["updated"] == 1
    after = {t["id"]: (t["category"], t["category_source"]) for t in (await client.get("/api/finances", headers=auth)).json()["transactions"]}
    assert after[pret[0]["id"]] == ("Lunch", "manual")
    assert after[pret[1]["id"]] == ("Coffee", "rule")


async def test_classify_endpoint_handles_existing_uncategorised(client, auth, model, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    await _setup(client, auth)                     # imported with no key: nothing categorised
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    r = (await client.post("/api/finances/classify", headers=auth)).json()
    assert r["categorised"] == 4   # 2 × Pret, the top-up, Tesco (no rule here)


def test_output_text_is_read_from_a_raw_responses_reply():
    body = {"output": [{"type": "reasoning"}, {"type": "message", "content": [{"type": "output_text", "text": '{"results": []}'}]}]}
    assert finance_classify._output_text(body) == '{"results": []}'
