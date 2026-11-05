"""
The weekly review's recap: the figures per section and the observations written
from them. Week 2026-10-26 (Mon) to 2026-11-01 (Sun), reviewed on the Sunday.
"""
from datetime import date, timedelta

import pytest

import weekly_review as wr

WEEK = "2026-10-26"
SUNDAY = date(2026, 11, 1)
MONDAY = date(2026, 10, 26)


async def _db():
    import mcp_server
    return await mcp_server._db()


async def _recap(**kw):
    db = await _db()
    try:
        return await wr.recap(db, WEEK, today=kw.pop("today", SUNDAY), **kw)
    finally:
        await db.close()


async def _habit(client, auth, id_, name, days, created="2026-09-01"):
    await client.post("/api/habits", json={"id": id_, "name": name, "color": "#6f8168", "created_at": created}, headers=auth)
    for d in days:
        await client.post(f"/api/habits/{id_}/toggle", json={"date": d.isoformat()}, headers=auth)


def _days(monday, n):
    return [monday + timedelta(days=i) for i in range(n)]


# ── Habits ────────────────────────────────────────────────────────────────────

async def test_slipped_habit_is_called_out_against_its_usual(client, auth):
    usual = [d for k in range(1, 5) for d in _days(MONDAY - timedelta(weeks=k), 6)]   # six days a week
    await _habit(client, auth, "h1", "Run", usual + _days(MONDAY, 2))
    await _habit(client, auth, "h2", "Read", usual + _days(MONDAY, 7))
    out = (await _recap())["habits"]
    run = next(h for h in out["habits"] if h["id"] == "h1")
    assert (run["done"], run["possible"], run["usual_days"]) == (2, 7, 6.0)
    assert run["days"] == [True, True, False, False, False, False, False]
    warn = [i for i in out["insights"] if i["kind"] == "warn"]
    assert len(warn) == 1 and warn[0]["ref"] == {"type": "habit", "id": "h1"}
    assert "Run" in warn[0]["text"] and "2 of 7" in warn[0]["text"] and "6-days-a-week" in warn[0]["text"]
    assert any(i["kind"] == "good" and "Read" in i["text"] and "every day" in i["text"] for i in out["insights"])


async def test_a_habit_that_never_stuck_is_not_blamed(client, auth):
    await _habit(client, auth, "h1", "Meditate", _days(MONDAY - timedelta(weeks=1), 1))   # once, a while ago
    out = (await _recap())["habits"]
    assert [i for i in out["insights"] if i["kind"] == "warn"] == []


async def test_a_habit_made_mid_week_is_judged_only_from_then(client, auth):
    await _habit(client, auth, "h1", "Stretch", _days(MONDAY + timedelta(days=4), 3), created="2026-10-30")
    h = (await _recap())["habits"]["habits"][0]
    assert (h["done"], h["possible"]) == (3, 3)


async def test_an_unfinished_week_counts_only_days_so_far(client, auth):
    await _habit(client, auth, "h1", "Run", _days(MONDAY, 2))
    h = (await _recap(today=MONDAY + timedelta(days=2)))["habits"]["habits"][0]
    assert (h["done"], h["possible"]) == (2, 3)


async def test_streak_counts_back_and_todays_gap_does_not_break_it(client, auth):
    await _habit(client, auth, "h1", "Write", [SUNDAY - timedelta(days=i) for i in range(1, 8)])   # Sat back 7 days
    out = await _recap(today=SUNDAY)
    assert out["habits"]["habits"][0]["streak"] == 7
    assert any("7-day streak" in i["text"] for i in out["habits"]["insights"])


# ── To-dos ────────────────────────────────────────────────────────────────────

async def _todo(id_, text, bucket="week", done=0, created="2026-10-20", completed=None, goal=None, parent=None):
    db = await _db()
    try:
        await db.execute("INSERT INTO todos (id,text,bucket,goal_id,done,created_at,completed_at,parent_id) VALUES (?,?,?,?,?,?,?,?)",
                         (id_, text, bucket, goal, done, created, completed, parent))
        await db.commit()
    finally:
        await db.close()


async def test_old_open_todo_is_flagged_with_its_age(client, auth):
    await _todo("t1", "File taxes", created="2026-10-01T09:00:00.000Z")
    await _todo("t2", "Buy milk", created="2026-10-30T09:00:00.000Z")
    out = (await _recap())["todos"]
    flagged = [i for i in out["insights"] if i["kind"] == "warn"]
    assert [i["ref"] for i in flagged] == [{"type": "todo", "id": "t1"}]
    assert "File taxes" in flagged[0]["text"] and "4 weeks" in flagged[0]["text"]
    assert out["open"][0]["id"] == "t1" and out["stale_count"] == 1       # oldest first


async def test_finished_todos_are_counted_in_the_week_they_were_done(client, auth):
    await _todo("a", "Done Tue", done=1, completed="2026-10-27T10:00:00.000Z")
    await _todo("b", "Done last week", done=1, completed="2026-10-21T10:00:00.000Z")
    await _todo("c", "Done Sunday night", done=1, completed="2026-11-01T22:30:00.000Z")
    await _todo("d", "Someday thing", bucket="someday")
    await _todo("e", "A sub-task", done=1, completed="2026-10-28T10:00:00.000Z", parent="a")
    out = (await _recap())["todos"]
    assert sorted(t["id"] for t in out["finished"]) == ["a", "c"]
    assert out["prev_finished_count"] == 1
    assert out["someday_count"] == 1 and out["open_count"] == 0
    assert any("up from 1" in i["text"] for i in out["insights"])


# ── Goals ─────────────────────────────────────────────────────────────────────

async def test_goal_with_waiting_todos_but_no_progress_is_a_warning(client, auth):
    await client.post("/api/goals", json={"id": "g1", "title": "Learn Spanish", "color": "#c15f3c", "created_at": "2026-01-01", "q4": "Reach B1"}, headers=auth)
    await client.post("/api/goals", json={"id": "g2", "title": "Fitness", "color": "#6f8168", "created_at": "2026-01-02"}, headers=auth)
    await _todo("t1", "Do lesson 4", goal="g1")
    await _todo("t2", "Gym", done=1, completed="2026-10-28T08:00:00.000Z", goal="g2")
    out = (await _recap())["goals"]
    assert out["quarter"] == "Q4"
    spanish = next(g for g in out["goals"] if g["id"] == "g1")
    assert spanish["focus"] == "Reach B1" and spanish["open_this_week"] == 1
    kinds = {i["ref"]["id"]: i["kind"] for i in out["insights"]}
    assert kinds == {"g1": "warn", "g2": "good"}
    assert out["insights"][0]["ref"]["id"] == "g1"                       # warnings first


# ── Money ─────────────────────────────────────────────────────────────────────

async def _txn(client, auth, id_, merchant, amount, day, category="", type_="expense"):
    r = await client.post("/api/finances/transactions", json={
        "id": id_, "merchant": merchant, "category": category, "amount": amount, "date": day.isoformat(),
        "type": type_, "currency": "EUR"}, headers=auth)
    assert r.status_code == 200, r.text


async def test_money_compares_the_week_with_the_usual_and_finds_what_needs_sorting(client, auth):
    for k in range(1, 5):                                                # €100 groceries a week before
        await _txn(client, auth, f"p{k}", "Tesco", 100, MONDAY - timedelta(weeks=k) + timedelta(days=2), "Groceries")
    await _txn(client, auth, "w1", "Tesco", 120, MONDAY + timedelta(days=1), "Groceries")
    await _txn(client, auth, "w2", "Fancy Restaurant", 180, MONDAY + timedelta(days=4), "Eating out")
    await _txn(client, auth, "w3", "Mystery Co", 15, MONDAY + timedelta(days=5))
    await _txn(client, auth, "w4", "Employer", 2000, MONDAY + timedelta(days=3), "Salary", "income")
    m = (await _recap(currency="EUR"))["money"]
    assert (m["spent"], m["income"], m["count"]) == (315.0, 2000.0, 4)
    assert m["usual_spent"] == 100.0
    assert [c["category"] for c in m["categories"]] == ["Eating out", "Groceries", "Uncategorised"]
    assert m["categories"][1]["usual"] == 100.0
    assert [u["merchant"] for u in m["uncategorised"]] == ["Mystery Co"]
    assert m["biggest"][0]["merchant"] == "Fancy Restaurant"
    texts = [i["text"] for i in m["insights"]]
    assert any("€315" in t and "more than your usual €100" in t for t in texts)
    assert any("1 transaction still need" in t for t in texts)
    assert m["stale"] is False


async def test_money_says_when_the_statement_is_out_of_date(client, auth):
    await _txn(client, auth, "old", "Tesco", 40, MONDAY - timedelta(days=9), "Groceries")
    m = (await _recap())["money"]
    assert m["stale"] is True and m["last_transaction"] == "2026-10-17"
    assert m["insights"][0]["ref"] == {"type": "import"} and "17 Oct" in m["insights"][0]["text"]


async def test_money_with_no_data_at_all(client, auth):
    m = (await _recap())["money"]
    assert (m["spent"], m["count"], m["usual_spent"]) == (0, 0, None)
    assert m["insights"][0]["ref"] == {"type": "import"}


async def test_budget_over_is_reported(client, auth):
    await client.post("/api/finances/budgets", json={"id": "b1", "category": "Eating out", "amount": 100, "currency": "EUR"}, headers=auth)
    await _txn(client, auth, "w1", "Fancy Restaurant", 180, MONDAY + timedelta(days=4), "Eating out")
    m = (await _recap())["money"]
    assert m["budgets"][0]["over"] is True
    assert any("Eating out budget is over for October" in i["text"] for i in m["insights"])


# ── Commentary ────────────────────────────────────────────────────────────────

async def test_narrative_without_a_model_is_the_plain_observations(client, auth, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    await _todo("t1", "File taxes", created="2026-10-01T09:00:00.000Z")
    r = await client.post(f"/api/weekly-review/{WEEK}/narrate", json={}, headers=auth)
    body = r.json()
    assert r.status_code == 200 and body["source"] == "plain"
    assert "File taxes" in body["todos"]


async def test_narrative_is_kept_until_the_figures_change(client, auth, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    calls = []

    async def fake(facts):
        calls.append(facts)
        return {"headline": "A steady week", "goals": "", "money": "", "habits": "", "todos": "Tidy.", "plan": ""}

    monkeypatch.setattr(wr, "_call_model", fake)
    url = f"/api/weekly-review/{WEEK}/narrate"
    first = (await client.post(url, json={}, headers=auth)).json()
    again = (await client.post(url, json={}, headers=auth)).json()
    assert first == again and first["source"] == "model" and len(calls) == 1
    await _todo("t1", "A new one", created="2026-10-30")
    await client.post(url, json={}, headers=auth)
    assert len(calls) == 2
    await client.post(url, json={"refresh": True}, headers=auth)
    assert len(calls) == 3


async def test_the_model_is_never_told_merchant_names(client, auth, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    seen = []

    async def fake(facts):
        seen.append(str(facts))
        return {"headline": "", "goals": "", "money": "", "habits": "", "todos": "", "plan": ""}

    monkeypatch.setattr(wr, "_call_model", fake)
    await _txn(client, auth, "w1", "Very Private Clinic", 180, MONDAY + timedelta(days=4), "Health")
    await client.post(f"/api/weekly-review/{WEEK}/narrate", json={}, headers=auth)
    assert "Very Private Clinic" not in seen[0] and "Health" in seen[0]


async def test_a_model_failure_falls_back_instead_of_erroring(client, auth, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    async def boom(facts):
        raise RuntimeError("down")

    monkeypatch.setattr(wr, "_call_model", boom)
    r = await client.post(f"/api/weekly-review/{WEEK}/narrate", json={}, headers=auth)
    assert r.status_code == 200 and r.json()["source"] == "plain"


# ── Endpoints ─────────────────────────────────────────────────────────────────

async def test_completed_weeks_round_trip(client, auth):
    assert (await client.get("/api/weekly-review/completed", headers=auth)).json() == {"weeks": []}
    await client.put(f"/api/weekly-review/{WEEK}/complete", headers=auth)
    await client.put("/api/weekly-review/2026-10-19/complete", headers=auth)
    assert (await client.get("/api/weekly-review/completed", headers=auth)).json() == {"weeks": [WEEK, "2026-10-19"]}
    assert (await client.get(f"/api/weekly-review/{WEEK}", headers=auth)).json()["completed_at"]
    await client.delete(f"/api/weekly-review/{WEEK}/complete", headers=auth)
    assert (await client.get("/api/weekly-review/completed", headers=auth)).json() == {"weeks": ["2026-10-19"]}


@pytest.mark.parametrize("week", ["2026-10-27", "not-a-date", "2026-13-01"])
async def test_a_week_must_be_a_monday(client, auth, week):
    assert (await client.get(f"/api/weekly-review/{week}", headers=auth)).status_code == 422
    assert (await client.put(f"/api/weekly-review/{week}/complete", headers=auth)).status_code == 422


async def test_requires_login(client):
    assert (await client.get(f"/api/weekly-review/{WEEK}")).status_code in (401, 403)
