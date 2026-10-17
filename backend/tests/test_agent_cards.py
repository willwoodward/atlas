"""
The cards the assistant's tools draw in the chat: each tool returns the facts
for the model and a `card` for the browser. What's checked is the card data.
"""
import json
from datetime import date, timedelta

import pytest


@pytest.fixture
async def db():
    import mcp_server
    conn = await mcp_server._db()
    yield conn
    await conn.close()


async def call(db, _tool, **args):
    import mcp_server
    return await mcp_server.run_tool(_tool, args, db)


def ago(n):
    return (date.today() - timedelta(days=n)).isoformat()


async def seed_txns(db, rows):
    for i, (merchant, cat, amount, day, kind, account) in enumerate(rows):
        await db.execute(
            "INSERT INTO finances_transactions (id, merchant, category, amount, date, type, currency, account_id) VALUES (?,?,?,?,?,?, 'EUR', ?)",
            (f"t{i}", merchant, cat, amount, day, kind, account))
    await db.commit()


class TestFixes:
    async def test_breakdown_rows_carry_what_tapping_needs(self, db):
        await seed_txns(db, [("Tesco", "Groceries", 40, ago(2), "expense", None)])
        card = (await call(db, "finance_breakdown"))["card"]
        assert card["kind"] == "expense" and card["range"]["to"] == date.today().isoformat()

    async def test_several_days_side_by_side(self, db):
        await db.execute("INSERT INTO local_events (id, title, date, start_h, end_h) VALUES ('e1','Gym',?,7,8)", (ago(-1),))
        await db.commit()
        card = (await call(db, "show_day", date=date.today().isoformat(), days=3))["card"]
        assert [len(d["events"]) for d in card["days"]] == [0, 1, 0]
        assert card["days"][1]["events"][0]["title"] == "Gym" and "–" in card["title"]

    async def test_one_day_still_has_events_for_old_clients(self, db):
        card = (await call(db, "show_day", date=date.today().isoformat()))["card"]
        assert card["events"] == [] and len(card["days"]) == 1

    async def test_free_time_draws_a_week(self, db):
        tomorrow = ago(-1)
        await db.execute("INSERT INTO local_events (id, title, date, start_h, end_h) VALUES ('e1','Dentist',?,10,11)", (tomorrow,))
        await db.commit()
        r = await call(db, "find_free_time", start=tomorrow, end=tomorrow, hours=2)
        day = r["card"]["days"][0]
        assert day["busy"] == [{"start": 10, "end": 11, "title": "Dentist"}]
        assert day["free"] == [{"start": 8.0, "end": 10.0}, {"start": 11.0, "end": 22.0}]
        assert "busy" not in r["days"][0]   # the model gets the free slots only

    async def test_budgets_with_pace(self, db):
        await seed_txns(db, [("Tesco", "Groceries", 100, date.today().replace(day=1).isoformat(), "expense", None)])
        await call(db, "set_budget", name="Food", amount=300, categories=["Groceries"])
        card = (await call(db, "get_budgets"))["card"]
        assert card["type"] == "budgets" and card["rows"][0]["spent"] == 100 and 0 < card["elapsed"] <= 1


class TestChanges:
    async def test_moving_a_todo_shows_before_and_after(self, db):
        r = await call(db, "add_todo", text="Renew passport", bucket="someday")
        card = (await call(db, "move_todo", id=r["id"], bucket="today"))["card"]
        assert card == {"type": "change", "title": "To-do · Renew passport",
                        "rows": [{"label": "List", "before": "Someday", "after": "Today"}],
                        "show": {"kind": "todo", "id": r["id"]}}

    async def test_unchanged_fields_are_left_out(self, db):
        await db.execute("INSERT INTO goals (id, title, color, created_at, tags) VALUES ('g1','Fitness','#000','2026-01-01','gym')")
        await db.commit()
        card = (await call(db, "update_goal", id="g1", tags="gym, run"))["card"]
        assert card["rows"] == [{"label": "Calendar tags", "before": "gym", "after": "gym, run"}]

    async def test_category_change(self, db):
        await seed_txns(db, [("Irish Rail", "", 12, ago(1), "expense", None)])
        card = (await call(db, "set_transaction_category", ids=["t0"], category="Transport"))["card"]
        assert card["rows"] == [{"label": "Category", "before": "Uncategorised", "after": "Transport"}]

    async def test_completing_a_todo_shows_it_ticked(self, db):
        r = await call(db, "add_todo", text="Call bank", bucket="today")
        card = (await call(db, "complete_todo", id=r["id"]))["card"]
        assert card["type"] == "todos" and card["rows"][0]["done"] is True

    async def test_notes_show_a_preview(self, db):
        r = await call(db, "create_note", body="# Packing\n- passport\n- charger")
        assert r["card"] == {"type": "note", "id": r["id"], "title": "Packing", "snippet": "- passport\n- charger"}
        r2 = await call(db, "append_to_note", id=r["id"], text="- adapter")
        assert r2["card"]["added"] == "- adapter" and r2["card"]["snippet"].endswith("- adapter")


class TestNewCards:
    async def test_todos_checklist(self, db):
        await call(db, "add_todo", text="A", bucket="today")
        await call(db, "add_todo", text="B", bucket="week")
        await call(db, "add_todo", text="C", bucket="someday")
        r = await call(db, "show_todos")
        assert [x["text"] for x in r["card"]["rows"]] == ["A", "B"] and r["open"] == 2

    async def test_habit_streaks(self, db):
        await db.execute("INSERT INTO habits (id, name, color, created_at) VALUES ('h1','Read','#000','2026-01-01')")
        for n in (0, 1, 2, 5):
            await db.execute("INSERT INTO habit_completions (habit_id, date) VALUES ('h1', ?)", (ago(n),))
        await db.commit()
        row = (await call(db, "habit_streaks"))["card"]["rows"][0]
        assert row["streak"] == 3 and row["done"][-3:] == [True, True, True] and len(row["done"]) == 7

    async def test_spending_trend_by_month(self, db):
        first = date.today().replace(day=1)
        last_month = (first - timedelta(days=1)).replace(day=3)
        await seed_txns(db, [("Tesco", "Groceries", 40, first.isoformat(), "expense", None),
                             ("Tesco", "Groceries", 60, last_month.isoformat(), "expense", None),
                             ("Pret", "Eating out", 9, first.isoformat(), "expense", None)])
        pts = (await call(db, "spending_trend", by="month", count=3, category="groceries"))["card"]["points"]
        assert [p["value"] for p in pts] == [0, 60, 40] and pts[-1]["current"]

    async def test_net_worth_is_walked_back_through_transactions(self, db):
        await db.execute("INSERT INTO finances_accounts (id, name, type, balance, currency) VALUES ('a1','Current','checking',1000,'EUR')")
        await db.commit()
        first = date.today().replace(day=1)
        await seed_txns(db, [("Payroll", "Salary", 500, first.isoformat(), "income", "a1")])
        r = await call(db, "net_worth_trend", months=2)
        assert [p["value"] for p in r["card"]["points"]] == [500, 1000]
        assert "Estimated" in r["card"]["note"]

    async def test_goal_time_per_week(self, db):
        await db.execute("INSERT INTO goals (id, title, color, created_at, tags) VALUES ('g1','Fitness','#6f8168','2026-01-01','gym')")
        await db.execute("INSERT INTO local_events (id, title, date, start_h, end_h) VALUES ('e1','Gym session',?,7,8.5)", (ago(7),))
        await db.commit()
        pts = (await call(db, "goal_time", weeks=2))["card"]["points"]
        assert [p["value"] for p in pts] == [1.5, 0]   # last week, this week
        assert pts[0]["segments"] == [{"label": "Fitness", "value": 1.5, "color": "#6f8168"}]

    async def test_goal_time_needs_tags(self, db):
        assert "error" in await call(db, "goal_time")

    async def test_lift_progress(self, db):
        await db.execute("INSERT INTO gym_sections (id, name) VALUES ('s1','Legs')")
        await db.execute("INSERT INTO gym_exercises (id, section_id, name) VALUES ('x1','s1','Back squat')")
        for i, w in enumerate([60, 65, 70]):
            await db.execute("INSERT INTO gym_lift_log (id, exercise_id, date, weight) VALUES (?, 'x1', ?, ?)", (f"l{i}", ago(20 - i * 7), w))
        await db.commit()
        card = (await call(db, "lift_progress", exercise="squat"))["card"]
        assert [p["value"] for p in card["points"]] == [60, 65, 70] and card["title"].startswith("Back squat")

    async def test_choices(self, db):
        r = await call(db, "offer_choices", question="When?", options=["Tue 2pm", "Wed 10am"])
        assert r["card"] == {"type": "choices", "question": "When?", "options": ["Tue 2pm", "Wed 10am"]}
        assert "error" in await call(db, "offer_choices", question="?", options=["only one"])

    async def test_the_tools_are_listed(self):
        import mcp_server
        names = {t.name for t in await mcp_server.list_tools()}
        assert {"show_todos", "habit_streaks", "spending_trend", "net_worth_trend", "goal_time",
                "lift_progress", "show_note", "offer_choices"} <= names


def test_goal_tags_match_like_the_app():
    from agent_cards import matches_tag
    assert matches_tag("Gym session", "gym")
    assert not matches_tag("Gymnastics", "gym")
    assert matches_tag("Dinner w/ Sam", "dinner w/*")
    assert matches_tag("Long run", "*run") and not matches_tag("Brunch", "*run")
    assert matches_tag("[masters] reading", "[masters]")


class TestSnapshots:
    async def test_todays_values_are_recorded(self, db):
        import snapshots
        await db.execute("INSERT INTO finances_accounts (id, name, type, balance, currency) VALUES ('a1','Current','checking',1200,'EUR')")
        await db.commit()
        await call(db, "add_todo", text="A", bucket="today")
        vals = await snapshots.take(db)
        assert vals["net_worth"] == 1200 and vals["account:a1"] == 1200 and vals["open_todos"] == 1
        # The day's row is its latest value.
        await db.execute("UPDATE finances_accounts SET balance = 1300")
        await db.commit()
        await snapshots.take(db)
        assert await snapshots.value_on_or_before(db, "net_worth", date.today().isoformat()) == 1300

    async def test_net_worth_uses_recorded_months(self, db):
        await db.execute("INSERT INTO finances_accounts (id, name, type, balance, currency) VALUES ('a1','Current','checking',1000,'EUR')")
        last_month_end = date.today().replace(day=1) - timedelta(days=1)
        await db.execute("INSERT INTO daily_snapshots (date, key, value) VALUES (?, 'net_worth', 777)", (last_month_end.replace(day=20).isoformat(),))
        await db.commit()
        card = (await call(db, "net_worth_trend", months=2))["card"]
        assert [p["value"] for p in card["points"]] == [777, 1000]
        assert card["points"][0]["recorded"] and "1 month recorded" in card["note"]


async def test_todays_summary_draws_the_day_and_the_todos(db):
    await call(db, "add_todo", text="Renew passport", bucket="today")
    r = await call(db, "get_today_summary")
    assert [c["type"] for c in r["cards"]] == ["day", "todos"]
    assert r["cards"][1]["rows"][0]["text"] == "Renew passport" and r["cards"][0]["show"]["kind"] == "calendar"
