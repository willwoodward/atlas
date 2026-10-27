"""
History charts (history.py): recorded values, estimates before recording
began, ranges, cashflow and habit consistency.
"""
from datetime import date, timedelta

import history
import inbox

TODAY = date(2026, 10, 18)


async def _db():
    return await inbox.connect()


def d(n):
    return (TODAY - timedelta(days=n)).isoformat()


async def _accounts(db):
    await db.execute("INSERT INTO finances_accounts (id, name, type, balance, currency) VALUES ('a1','Current','checking',1000,'EUR')")
    await db.execute("INSERT INTO finances_accounts (id, name, type, balance, currency) VALUES ('c1','Card','credit',200,'EUR')")
    for i, (acc, kind, amount, day) in enumerate([("a1", "income", 500, d(5)), ("a1", "expense", 100, d(2)), ("c1", "expense", 50, d(1))]):
        await db.execute("INSERT INTO finances_transactions (id, merchant, category, amount, date, type, currency, account_id) "
                         "VALUES (?, 'x', 'Food', ?, ?, ?, 'EUR', ?)", (f"t{i}", amount, day, kind, acc))
    await db.commit()


class TestBalances:
    async def test_estimated_before_recording_then_recorded(self):
        db = await _db()
        try:
            await _accounts(db)
            await db.execute("INSERT INTO daily_snapshots (date, key, value) VALUES (?, 'net_worth', 777)", (d(1),))
            await db.commit()
            s = await history.series(db, "net_worth", "30d", TODAY)
        finally:
            await db.close()
        pts = {p["date"]: p for p in s["points"]}
        assert len(s["points"]) == 30 and s["recorded_since"] == d(1)
        # Today: 1000 in the current account, 200 owed on the card.
        # Six days ago: before the £500 came in and the £100 went out, before the £50 on the card.
        assert pts[d(6)] == {"date": d(6), "value": 1000 - 500 + 100 - (200 - 50), "estimated": True}
        assert pts[d(3)]["value"] == 1000 + 100 - 150 and pts[d(3)]["estimated"]
        # From the first recording on, recorded values (carried forward to today).
        assert pts[d(1)] == {"date": d(1), "value": 777, "estimated": False}
        assert pts[d(0)] == {"date": d(0), "value": 777, "estimated": False}

    async def test_one_account_by_id_or_name(self):
        db = await _db()
        try:
            await _accounts(db)
            by_id = await history.series(db, "account:a1", "30d", TODAY)
            by_name = await history.series(db, "account:current", "30d", TODAY)
            assert await history.series(db, "account:nope", "30d", TODAY) is None
        finally:
            await db.close()
        assert by_id["label"] == "Current" and by_id["currency"] == "EUR"
        assert by_id["points"] == by_name["points"] and by_name["key"] == "account:a1"
        assert by_id["points"][0]["value"] == 600   # before the income

    async def test_long_ranges_are_thinned(self):
        db = await _db()
        try:
            await _accounts(db)
            year = await history.series(db, "net_worth", "1y", TODAY)
        finally:
            await db.close()
        dates = [p["date"] for p in year["points"]]
        assert 52 <= len(dates) <= 54 and dates[-1] == TODAY.isoformat()
        assert all(date.fromisoformat(x).weekday() == 6 for x in dates[:-1])   # week ends

    async def test_saved_and_open_todos(self):
        db = await _db()
        try:
            await db.execute("INSERT INTO finances_pots (id, name, color, currency) VALUES ('p1','Trip','#000','EUR')")
            await db.execute("INSERT INTO finances_deposits (id, pot_id, amount, date) VALUES ('d1','p1',100,?)", (d(10),))
            await db.execute("INSERT INTO finances_deposits (id, pot_id, amount, date) VALUES ('d2','p1',50,?)", (d(3),))
            await db.execute("INSERT INTO todos (id, text, created_at) VALUES ('t1','A',?)", (d(9),))
            await db.execute("INSERT INTO todos (id, text, created_at, done, completed_at) VALUES ('t2','B',?,1,?)", (d(8), d(4)))
            await db.commit()
            saved = {p["date"]: p["value"] for p in (await history.series(db, "saved", "30d", TODAY))["points"]}
            todos = {p["date"]: p["value"] for p in (await history.series(db, "open_todos", "30d", TODAY))["points"]}
        finally:
            await db.close()
        assert saved[d(11)] == 0 and saved[d(10)] == 100 and saved[d(0)] == 150
        assert todos[d(10)] == 0 and todos[d(8)] == 2 and todos[d(4)] == 1


class TestOpenTodos:
    async def _add(self, db, id, created, done=0, completed=None, parent=None):
        await db.execute("INSERT INTO todos (id, text, created_at, done, completed_at, parent_id) VALUES (?,?,?,?,?,?)",
                         (id, id, created, done, completed, parent))

    async def test_sub_tasks_are_not_counted(self):
        """A finished to-do's leftover sub-tasks, and ones whose parent was deleted, aren't open work."""
        db = await _db()
        try:
            await self._add(db, "open", d(5))
            await self._add(db, "kid-of-open", d(5), parent="open")
            await self._add(db, "finished", d(5), done=1, completed=d(2))
            await self._add(db, "kid-of-finished", d(5), parent="finished")   # never ticked
            await self._add(db, "orphan", d(5), parent="deleted-long-ago")
            await db.commit()
            points = (await history.series(db, "open_todos", "30d", TODAY))["points"]
        finally:
            await db.close()
        by_day = {p["date"]: p["value"] for p in points}
        assert by_day[d(4)] == 2 and by_day[d(0)] == 1   # "open" and "finished" until it was done

    async def test_today_is_live_and_old_recordings_are_not_trusted(self):
        db = await _db()
        try:
            await self._add(db, "a", d(10))
            await self._add(db, "b", d(10), done=1, completed=d(0))
            # Recorded by the old count (sub-tasks and all), and an hour ago before "b" was ticked.
            for day, n in ((d(3), 9), (d(0), 2)):
                await db.execute("INSERT INTO daily_snapshots (date, key, value) VALUES (?, 'open_todos', ?)", (day, n))
            await db.commit()
            out = await history.series(db, "open_todos", "30d", TODAY)
        finally:
            await db.close()
        by_day = {p["date"]: p for p in out["points"]}
        assert by_day[d(3)]["value"] == 2 and by_day[d(3)]["estimated"]      # not the 9 recorded then
        assert by_day[d(0)]["value"] == 1 and not by_day[d(0)]["estimated"]  # live, not the stale 2

    async def test_recordings_from_the_new_count_are_kept(self):
        import snapshots
        db = await _db()
        try:
            await self._add(db, "a", d(10))
            await self._add(db, "kid", d(10), parent="a")
            await db.execute("INSERT INTO daily_snapshots (date, key, value) VALUES (?, 'open_todos', 7)", (d(8),))
            await db.commit()
            assert (await snapshots.take(db, TODAY - timedelta(days=5)))["open_todos"] == 1
            out = await history.series(db, "open_todos", "30d", TODAY)
        finally:
            await db.close()
        by_day = {p["date"]: p for p in out["points"]}
        assert by_day[d(8)]["estimated"] and by_day[d(8)]["value"] == 1
        assert not by_day[d(5)]["estimated"] and by_day[d(5)]["value"] == 1
        assert out["recorded_since"] == d(5)


class TestCashflowAndHabits:
    async def test_cashflow_by_month(self):
        db = await _db()
        try:
            await _accounts(db)
            out = await history.cashflow(db, 3, TODAY)
        finally:
            await db.close()
        assert [m["month"] for m in out["months"]] == ["2026-08", "2026-09", "2026-10"]
        assert out["months"][-1] == {"month": "2026-10", "label": "Oct", "income": 500, "spending": 150, "current": True}

    async def test_habit_consistency_by_week(self):
        db = await _db()
        try:
            await db.execute("INSERT INTO habits (id, name, color, created_at) VALUES ('h1','Read','#000',?)", (d(30),))
            await db.execute("INSERT INTO habits (id, name, color, created_at) VALUES ('h2','New','#000',?)", (d(1),))
            monday = TODAY - timedelta(days=TODAY.weekday())
            last_week = [monday - timedelta(days=7 - i) for i in range(7)]
            for day in last_week[:5]:
                await db.execute("INSERT INTO habit_completions (habit_id, date) VALUES ('h1', ?)", (day.isoformat(),))
            await db.commit()
            out = await history.habits(db, 3, TODAY)
        finally:
            await db.close()
        read, new = out["habits"]
        assert read["values"][1] == round(5 / 7 * 100)
        assert new["values"][:2] == [None, None]   # didn't exist yet


class TestApi:
    async def test_endpoints(self, client, auth):
        r = await client.get("/api/history?keys=net_worth,saved&range=90d", headers=auth)
        assert r.status_code == 200 and [s["key"] for s in r.json()["series"]] == ["net_worth", "saved"]
        assert {"key": "open_todos", "label": "Open to-dos"} in r.json()["available"]
        assert (await client.get("/api/history?range=5y", headers=auth)).status_code == 422
        assert (await client.get("/api/history/cashflow", headers=auth)).status_code == 200
        assert (await client.get("/api/history/habits", headers=auth)).status_code == 200
        assert (await client.get("/api/history")).status_code == 401

    async def test_atlas_draws_it(self):
        import mcp_server
        db = await _db()
        try:
            await _accounts(db)
            out = await mcp_server.run_tool("history_chart", {"chart": "balances", "series": ["net_worth", "account:Card"]}, db)
            cash = await mcp_server.run_tool("history_chart", {"chart": "cashflow", "months": 2}, db)
        finally:
            await db.close()
        assert out["card"]["type"] == "history" and [s["label"] for s in out["card"]["series"]] == ["Net worth", "Card"]
        assert cash["card"]["chart"] == "cashflow" and len(cash["months"]) == 2
