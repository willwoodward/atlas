"""
The assistant's tools and the action log behind its Undo button.

Tools are called the way the MCP server calls them (mcp_server._dispatch), so
these cover the registration as well as the handlers. Google Calendar is a
small in-memory stand-in: what matters is that an undo sends the right call.
"""
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
    return await mcp_server._dispatch(_tool, args, db)


async def undo(client, auth, result):
    resp = await client.post(f"/assistant/actions/{result['undo_id']}/undo", headers=auth)
    assert resp.status_code == 200, resp.text
    return resp.json()


def days_ago(n):
    return (date.today() - timedelta(days=n)).isoformat()


@pytest.fixture
async def txns(db):
    rows = [
        ("t1", "Tesco Stores 123", "Groceries", 40.0, days_ago(2), "expense", ""),
        ("t2", "Tesco Metro", "Groceries", 20.0, days_ago(10), "expense", ""),
        ("t3", "Irish Rail", "", 12.5, days_ago(5), "expense", ""),
        ("t4", "Irish Rail", "Travel", 12.5, days_ago(40), "expense", "ai"),
        ("t5", "Acme Payroll", "Salary", 3000.0, days_ago(3), "income", ""),
        ("t6", "Pret A Manger", "Eating out", 9.0, days_ago(1), "expense", "ai"),
    ]
    for r in rows:
        await db.execute(
            "INSERT INTO finances_transactions (id, merchant, category, amount, date, type, currency, category_source) "
            "VALUES (?,?,?,?,?,?, 'EUR', ?)", r)
    await db.commit()
    return rows


class TestFinance:
    async def test_breakdown_by_category_for_the_last_30_days(self, db, txns):
        r = await call(db, "finance_breakdown")
        assert r["period"]["label"] == "Last 30 days"
        assert {x["label"]: x["amount"] for x in r["rows"]} == {"Groceries": 60.0, "Uncategorised": 12.5, "Eating out": 9.0}
        assert r["total"] == 81.5
        assert r["card"]["type"] == "breakdown" and r["show"]["kind"] == "finances"

    async def test_breakdown_of_one_category_by_merchant(self, db, txns):
        r = await call(db, "finance_breakdown", category="groceries")
        assert r["by"] == "merchant"
        assert [x["label"] for x in r["rows"]] == ["Tesco Stores 123", "Tesco Metro"]

    async def test_income(self, db, txns):
        r = await call(db, "finance_breakdown", kind="income", period="all")
        assert r["rows"] == [{"label": "Salary", "amount": 3000.0, "count": 1}]

    async def test_search_by_merchant_and_category(self, db, txns):
        r = await call(db, "search_transactions", query="irish rail")
        assert {t["id"] for t in r["transactions"]} == {"t3", "t4"}
        r = await call(db, "search_transactions", category="Uncategorised")
        assert [t["id"] for t in r["transactions"]] == ["t3"]

    async def test_compare_periods(self, db, txns):
        r = await call(db, "compare_spending", period_a="30d", period_b="all")
        assert r["a"]["total"] == 81.5 and r["b"]["total"] == 94.0

    async def test_categories_and_rules(self, db, txns):
        r = await call(db, "list_categories")
        names = {c["name"] for c in r["categories"]}
        assert {"Groceries", "Travel", "Uncategorised"} <= names

    async def test_set_category_and_undo(self, db, txns, client, auth):
        r = await call(db, "set_transaction_category", ids=["t3"], category="Transport")
        assert r["updated"] == 1
        async with db.execute("SELECT category, category_source FROM finances_transactions WHERE id='t3'") as c:
            assert tuple(await c.fetchone()) == ("Transport", "manual")
        await undo(client, auth, r)
        async with db.execute("SELECT category, category_source FROM finances_transactions WHERE id='t3'") as c:
            assert tuple(await c.fetchone()) == ("", "")

    async def test_rename_merges_and_undo_splits_again(self, db, txns, client, auth):
        r = await call(db, "rename_category", old="Travel", new="Groceries")
        assert r["transactions"] == 1
        await undo(client, auth, r)
        async with db.execute("SELECT category FROM finances_transactions WHERE id='t4'") as c:
            assert (await c.fetchone())[0] == "Travel"

    async def test_rule_fills_blanks_and_ai_guesses_but_not_your_choices(self, db, txns, client, auth):
        await db.execute("UPDATE finances_transactions SET category='Commute', category_source='manual' WHERE id='t4'")
        await db.commit()
        r = await call(db, "add_category_rule", pattern="irish rail", category="Transport")
        assert r["updated_existing"] == 1
        async with db.execute("SELECT id, category FROM finances_transactions WHERE merchant='Irish Rail' ORDER BY id") as c:
            assert [tuple(x) for x in await c.fetchall()] == [("t3", "Transport"), ("t4", "Commute")]
        await undo(client, auth, r)
        async with db.execute("SELECT COUNT(*) FROM finances_import_rules") as c:
            assert (await c.fetchone())[0] == 0
        async with db.execute("SELECT category FROM finances_transactions WHERE id='t3'") as c:
            assert (await c.fetchone())[0] == ""

    async def test_budget_and_undo(self, db, txns, client, auth):
        r = await call(db, "set_budget", name="Food", amount=300, categories=["Groceries", "Eating out"])
        status = (await call(db, "get_budgets"))["budgets"]
        assert status and status[0]["category"] == "Food"
        await undo(client, auth, r)
        async with db.execute("SELECT COUNT(*) FROM finances_budgets") as c:
            assert (await c.fetchone())[0] == 0

    async def test_redacted_mode_hides_merchants(self, db, txns, monkeypatch):
        import mcp_server
        monkeypatch.setattr(mcp_server, "MCP_TRANSACTIONS", "redacted")
        r = await call(db, "search_transactions", query="tesco")
        assert {t["merchant"] for t in r["transactions"]} == {"[redacted]"}

    async def test_off_hides_the_finance_tools(self, db, monkeypatch):
        import mcp_server
        monkeypatch.setattr(mcp_server, "MCP_TRANSACTIONS", "off")
        names = {t.name for t in await mcp_server.list_tools()}
        assert "finance_breakdown" not in names and "find_free_time" in names
        assert "error" in await call(db, "finance_breakdown")


class TestEditsAndUndo:
    async def test_existing_tools_record_undo(self, db, client, auth):
        r = await call(db, "add_todo", text="Book train", bucket="week")
        await call(db, "complete_todo", id=r["id"])
        done = (await client.get("/assistant/actions", headers=auth)).json()["actions"]
        assert [a["summary"] for a in done] == ["Completed “Book train”", "Added to-do “Book train”"]
        await undo(client, auth, {"undo_id": done[0]["id"]})
        async with db.execute("SELECT done FROM todos WHERE id=?", (r["id"],)) as c:
            assert (await c.fetchone())[0] == 0
        await undo(client, auth, r)
        async with db.execute("SELECT COUNT(*) FROM todos") as c:
            assert (await c.fetchone())[0] == 0

    async def test_a_deleted_todo_comes_back(self, db, client, auth):
        r = await call(db, "add_todo", text="Keep me", bucket="today")
        d = await call(db, "delete_todo", id=r["id"])
        await undo(client, auth, d)
        async with db.execute("SELECT text FROM todos WHERE id=?", (r["id"],)) as c:
            assert (await c.fetchone())[0] == "Keep me"

    async def test_undo_only_once(self, db, client, auth):
        r = await call(db, "add_todo", text="x", bucket="today")
        await undo(client, auth, r)
        resp = await client.post(f"/assistant/actions/{r['undo_id']}/undo", headers=auth)
        assert resp.status_code == 409

    async def test_outcomes_undo_restores_the_old_text(self, db, client, auth):
        await call(db, "set_week_outcomes", text="Ship it")
        r = await call(db, "set_week_outcomes", text="Rewrite it all")
        await undo(client, auth, r)
        assert (await call(db, "get_week_outcomes"))["text"] == "Ship it"

    async def test_goal_tags_subtask_habit_notes(self, db, client, auth):
        await db.execute("INSERT INTO goals (id,title,color,created_at) VALUES ('g1','Masters','#5f7591','2026-01-01')")
        await db.commit()
        g = await call(db, "update_goal", id="g1", tags="[masters], thesis*", quarter="Q4", focus="Draft done")
        async with db.execute("SELECT tags, q4 FROM goals WHERE id='g1'") as c:
            assert tuple(await c.fetchone()) == ("[masters], thesis*", "Draft done")
        await undo(client, auth, g)
        async with db.execute("SELECT tags, q4 FROM goals WHERE id='g1'") as c:
            assert tuple(await c.fetchone()) == ("", "")

        t = await call(db, "add_todo", text="Trip", bucket="week")
        s = await call(db, "add_subtask", parent_id=t["id"], text="Pack")
        async with db.execute("SELECT parent_id, bucket FROM todos WHERE id=?", (s["id"],)) as c:
            assert tuple(await c.fetchone()) == (t["id"], "week")

        h = await call(db, "create_habit", name="Stretch", period="morning")
        async with db.execute("SELECT color FROM habits WHERE id=?", (h["id"],)) as c:
            assert (await c.fetchone())[0] == "#6f8168"

        n = await call(db, "create_note", body="# Ideas\none")
        a = await call(db, "append_to_note", id=n["id"], text="two")
        async with db.execute("SELECT body FROM notes WHERE id=?", (n["id"],)) as c:
            assert (await c.fetchone())[0] == "# Ideas\none\ntwo"
        await undo(client, auth, a)
        d = await call(db, "delete_note", id=n["id"])
        await undo(client, auth, d)
        async with db.execute("SELECT body FROM notes WHERE id=?", (n["id"],)) as c:
            assert (await c.fetchone())[0] == "# Ideas\none"

    async def test_actions_need_a_token(self, client):
        assert (await client.get("/assistant/actions")).status_code == 401
        assert (await client.post("/assistant/actions/x/undo")).status_code == 401


class TestCalendar:
    @pytest.fixture
    def google(self, monkeypatch):
        """In-memory Google Calendar: events by id; records every call."""
        import mcp_server
        events, calls = {}, []

        async def fake_write(db, method, path="", body=None):
            calls.append((method, path, body))
            eid = path.lstrip("/")
            if method == "POST":
                new = {"id": f"g{len(events) + 1}", **(body or {})}
                events[new["id"]] = new
                return True, new
            if eid not in events:
                return False, "Google Calendar rejected the request (404)"
            if method == "GET":
                return True, dict(events[eid])
            if method == "PATCH":
                for k, v in (body or {}).items():
                    if v is None:
                        events[eid].pop(k, None)
                    else:
                        events[eid][k] = v
                return True, dict(events[eid])
            if method == "DELETE":
                del events[eid]
                return True, {}

        monkeypatch.setattr(mcp_server, "_gcal_write", fake_write)
        return events, calls

    async def test_recolour_and_undo(self, db, client, auth, google):
        events, _ = google
        e = await call(db, "create_event", title="Gym", date="2026-11-02", start=7, end=8)
        assert events[e["id"]]["colorId"] == "9"  # sport → blueberry, from the title
        u = await call(db, "update_event", id=e["id"], color="sage", title="Coffee with Sam")
        ev = events[e["id"]]
        assert ev["extendedProperties"]["private"]["atlasColor"] == "sage"
        assert ev["colorId"] == "4" and ev["summary"] == "Coffee with Sam"  # retitled → flamingo
        await undo(client, auth, u)
        ev = events[e["id"]]
        assert ev["colorId"] == "9" and ev["summary"] == "Gym"
        assert ev["extendedProperties"]["private"]["atlasColor"] == ""

    async def test_google_colour_comes_from_the_title(self, db, client, auth, google):
        events, _ = google
        for title, cid in [("Work", "2"), ("Sleep", "5"), ("Dinner with Jo", "4"), ("Church", "3"),
                           ("Football", "9"), ("Masters project", "1")]:
            e = await call(db, "create_event", title=title, date="2026-11-05", start=9, end=10)
            assert events[e["id"]]["colorId"] == cid, title
            assert "extendedProperties" not in events[e["id"]]
        e = await call(db, "create_event", title="Lunch", date="2026-11-05", start=12, end=13, color="gold")
        assert "colorId" not in events[e["id"]]  # on my own → the calendar's colour
        assert events[e["id"]]["extendedProperties"]["private"]["atlasColor"] == "gold"

    async def test_deleted_event_is_recreated(self, db, client, auth, google):
        events, _ = google
        e = await call(db, "create_event", title="Dentist", date="2026-11-03", start=10, end=11, color="coral")
        d = await call(db, "delete_event", id=e["id"])
        assert e["id"] not in events
        await undo(client, auth, d)
        [ev] = events.values()
        assert (ev["summary"], ev.get("colorId"), ev["extendedProperties"]["private"]["atlasColor"]) == ("Dentist", "5", "coral")

    async def test_created_event_undo_deletes_it(self, db, client, auth, google):
        events, _ = google
        e = await call(db, "create_event", title="Lunch", date="2026-11-04", start=12, end=13)
        await undo(client, auth, e)
        assert events == {}

    async def test_free_time_around_local_events(self, db):
        day = (date.today() + timedelta(days=3)).isoformat()
        await db.execute("INSERT INTO local_events (id,title,date,start_h,end_h) VALUES ('l1','Work',?,9,17)", (day,))
        await db.commit()
        r = await call(db, "find_free_time", start=day, end=day, hours=2)
        assert r["days"][0]["free"] == [{"start": 17, "end": 22}]
        r = await call(db, "find_free_time", start=day, end=day, hours=1)
        assert r["days"][0]["free"] == [{"start": 8, "end": 9}, {"start": 17, "end": 22}]

    async def test_search_and_show_day(self, db):
        day = (date.today() + timedelta(days=1)).isoformat()
        await db.execute("INSERT INTO local_events (id,title,date,start_h,end_h) VALUES ('l2','Thesis writing',?,14,16)", (day,))
        await db.commit()
        assert (await call(db, "search_events", query="thesis"))["matches"] == 1
        card = (await call(db, "show_day", date=day))["card"]
        assert card["type"] == "day" and card["events"][0]["title"] == "Thesis writing"


class TestShow:
    async def test_show_finances_with_a_category(self, db):
        r = await call(db, "show", view="finances", category="Groceries", period="month")
        assert r["show"]["kind"] == "finances" and r["show"]["category"] == "Groceries" and r["show"]["explicit"]

    async def test_show_an_event(self, db):
        r = await call(db, "show", view="calendar", event_id="e1", date="2026-11-02")
        assert r["show"] == {"kind": "event", "id": "e1", "date": "2026-11-02", "explicit": True}


class TestFollowAlong:
    async def test_a_change_says_where_to_see_it(self, db):
        import mcp_server
        r = await mcp_server.run_tool("add_todo", {"text": "Renew passport", "bucket": "week"}, db)
        assert r["show"] == {"kind": "todo", "id": r["id"]}

    async def test_a_read_only_tool_adds_nothing(self, db):
        import mcp_server
        r = await mcp_server.run_tool("list_todos", {}, db)
        assert isinstance(r, list)
