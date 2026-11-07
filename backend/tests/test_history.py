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
    async def test_follows_transaction_dates_not_when_balances_were_recorded(self):
        db = await _db()
        try:
            await _accounts(db)
            # Recordings that sit flat at 777 (the balance only changed when a statement
            # was imported) must not stand in for what the dated transactions say.
            await db.execute("INSERT INTO daily_snapshots (date, key, value) VALUES (?, 'net_worth', 777)", (d(1),))
            await db.commit()
            s = await history.series(db, "net_worth", "30d", TODAY)
        finally:
            await db.close()
        pts = {p["date"]: p for p in s["points"]}
        assert len(s["points"]) == 30 and s["recorded_since"] is None
        # Today: 1000 in the current account, 200 owed on the card = 800. Walk back:
        # the 50 on the card was on d(1), the 100 out on d(2), the 500 in on d(5).
        assert pts[d(0)]["value"] == 800 and pts[d(1)]["value"] == 800
        assert pts[d(2)]["value"] == 1000 - (200 - 50)                 # end of d(2): the card's 50 not spent yet
        assert pts[d(6)]["value"] == 1000 - 500 + 100 - (200 - 50)
        # Dashed only before the first transaction (d(5)), where nothing says what it was.
        assert pts[d(6)]["estimated"] and not pts[d(5)]["estimated"] and not pts[d(0)]["estimated"]

    async def test_an_account_without_transactions_follows_its_own_recordings(self):
        db = await _db()
        try:
            await db.execute("INSERT INTO finances_accounts (id, name, type, balance, currency) VALUES ('s1','Savings','savings',900,'EUR')")
            await db.execute("INSERT INTO daily_snapshots (date, key, value) VALUES (?, 'account:s1', 700)", (d(3),))
            await db.commit()
            s = await history.series(db, "net_worth", "30d", TODAY)
        finally:
            await db.close()
        pts = {p["date"]: p["value"] for p in s["points"]}
        assert pts[d(5)] == 900 and pts[d(3)] == 700 and pts[d(1)] == 700      # held flat before recording, then as recorded
        assert pts[d(0)] == 900                                                 # today is the balance now

    async def test_today_follows_a_balance_changed_since_the_last_recording(self):
        db = await _db()
        try:
            await _accounts(db)
            await db.execute("INSERT INTO daily_snapshots (date, key, value) VALUES (?, 'net_worth', 800)", (d(0),))
            await db.execute("UPDATE finances_accounts SET balance = 2000 WHERE id = 'a1'")
            await db.commit()
            s = await history.series(db, "net_worth", "30d", TODAY)
        finally:
            await db.close()
        assert s["points"][-1] == {"date": d(0), "value": 1800, "estimated": False}

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

    async def test_habit_consistency_by_time_of_day(self):
        db = await _db()
        try:
            # Two morning habits (sage) and one evening (mauve); the evening one is new.
            await db.execute("INSERT INTO habits (id, name, color, created_at) VALUES ('m1','Read','#6f8168',?)", (d(30),))
            await db.execute("INSERT INTO habits (id, name, color, created_at) VALUES ('m2','Stretch','#6f8168',?)", (d(30),))
            await db.execute("INSERT INTO habits (id, name, color, created_at) VALUES ('e1','Journal','#9a6d84',?)", (d(1),))
            monday = TODAY - timedelta(days=TODAY.weekday())
            last_week = [monday - timedelta(days=7 - i) for i in range(7)]
            for day in last_week:                                   # Read every day last week; Stretch never
                await db.execute("INSERT INTO habit_completions (habit_id, date) VALUES ('m1', ?)", (day.isoformat(),))
            await db.commit()
            out = await history.habits(db, 3, TODAY)
        finally:
            await db.close()
        assert [g["id"] for g in out["groups"]] == ["morning", "evening"]      # no daytime habits, so no line
        morning, evening = out["groups"]
        assert morning["habits"] == 2 and morning["values"][1] == 50           # 7 of 14 habit-days
        assert evening["values"][:2] == [None, None]                           # didn't exist yet


class TestExplain:
    async def _line(self, db):
        await _accounts(db)
        # Recordings for the whole window, so the change is recorded, not estimated.
        for n in range(0, 8):
            await db.execute("INSERT INTO daily_snapshots (date, key, value) VALUES (?, 'net_worth', ?)", (d(n), 500))
        await db.commit()

    async def test_biggest_movers_and_what_is_left_over(self):
        db = await _db()
        try:
            await self._line(db)
            # Window d(6)..d(0): +500 salary (d5), -100 (d2) from the account, -50 on the card (d1) = +350
            out = await history.explain(db, "net_worth", d(6), d(0), "30d", TODAY)
        finally:
            await db.close()
        assert out["explained"] == 350 and out["count"] == 3
        assert [r["amount"] for r in out["up"]] == [500] and [r["amount"] for r in out["down"]] == [-100, -50]
        assert out["start_value"] == 450 and out["end_value"] == 800 and out["change"] == 350 and out["other"] == 0
        assert out["categories"] == [{"category": "Food", "amount": 350.0, "count": 3}]

    async def test_an_account_with_transactions_ignores_its_recordings_when_explaining(self):
        db = await _db()
        try:
            await _accounts(db)
            await db.execute("INSERT INTO daily_snapshots (date, key, value) VALUES (?, 'account:a1', 1000)", (d(6),))
            await db.commit()
            out = await history.explain(db, "account:a1", d(6), d(0), "30d", TODAY)
        finally:
            await db.close()
        # An account with transactions is built from them, so nothing is left over.
        assert out["other"] == 0

    async def test_transfers_between_accounts_are_left_out_of_the_lists_but_still_counted(self):
        db = await _db()
        try:
            await self._line(db)
            for i, (acc, kind) in enumerate([("a1", "expense"), ("c1", "income")]):
                await db.execute("INSERT INTO finances_transactions (id, merchant, category, amount, date, type, currency, account_id) "
                                 "VALUES (?, 'Card payment', 'Transfer', 300, ?, ?, 'EUR', ?)", (f"x{i}", d(3), kind, acc))
            await db.commit()
            out = await history.explain(db, "net_worth", d(6), d(0), "30d", TODAY)
        finally:
            await db.close()
        assert all(r["category"] != "Transfer" for r in out["up"] + out["down"] + [{"category": c["category"]} for c in out["categories"]])
        assert out["explained"] == 350 and out["count"] == 5      # the two legs cancel

    async def test_a_transfer_with_no_other_leg_is_real_money_out_and_is_listed(self):
        db = await _db()
        try:
            await self._line(db)
            await db.execute("INSERT INTO finances_transactions (id, merchant, category, amount, date, type, currency, account_id) "
                             "VALUES ('x1', 'Sent money to family', 'Transfer', 300, ?, 'expense', 'EUR', 'a1')", (d(3),))
            await db.commit()
            out = await history.explain(db, "net_worth", d(6), d(0), "30d", TODAY)
        finally:
            await db.close()
        assert [r["merchant"] for r in out["down"]][0] == "Sent money to family"
        assert {"category": "Transfer", "amount": -300.0, "count": 1} in out["categories"]

    async def test_what_is_listed_plus_the_smaller_ones_adds_up_to_the_change(self):
        db = await _db()
        try:
            await self._line(db)
            for i in range(8):
                await db.execute("INSERT INTO finances_transactions (id, merchant, category, amount, date, type, currency, account_id) "
                                 "VALUES (?, 'Coffee', 'Eating out', ?, ?, 'expense', 'EUR', 'a1')", (f"s{i}", 1 + i, d(4)))
            await db.commit()
            out = await history.explain(db, "net_worth", d(6), d(0), "30d", TODAY)
        finally:
            await db.close()
        listed = sum(r["amount"] for r in out["up"] + out["down"])
        assert out["rest"]["count"] == out["count"] - len(out["up"] + out["down"]) > 0
        assert round(listed + out["rest"]["amount"], 2) == out["explained"]
        assert out["change"] == round(out["explained"] + out["other"], 2)

    async def test_names_the_account_that_moved_with_no_transaction(self):
        db = await _db()
        try:
            await self._line(db)
            await db.execute("INSERT INTO finances_accounts (id, name, type, balance, currency) VALUES ('s1','Savings','savings',900,'EUR')")
            for n, v in [(6, 1700), (5, 1700), (4, 1700), (3, 1700), (2, 1700), (1, 1700)]:
                await db.execute("INSERT INTO daily_snapshots (date, key, value) VALUES (?, 'account:s1', ?)", (d(n), v))
            await db.commit()
            out = await history.explain(db, "net_worth", d(6), d(0), "30d", TODAY)
        finally:
            await db.close()
        assert out["other_accounts"] == [{"account": "Savings", "amount": -800.0}]
        assert out["other"] == -800

    async def test_a_credit_card_line_rises_when_you_spend(self):
        db = await _db()
        try:
            await _accounts(db)
            for n in range(0, 4):
                await db.execute("INSERT INTO daily_snapshots (date, key, value) VALUES (?, 'account:c1', 150)", (d(n),))
            await db.commit()
            out = await history.explain(db, "account:Card", d(3), d(0), "30d", TODAY)
        finally:
            await db.close()
        assert out["down"] == [] and [r["amount"] for r in out["up"]] == [50]       # the 50 spent raised what's owed

    async def test_bad_requests(self):
        import pytest
        db = await _db()
        try:
            await self._line(db)
            with pytest.raises(ValueError):
                await history.explain(db, "saved", d(6), d(0), "30d", TODAY)
            with pytest.raises(ValueError):
                await history.explain(db, "net_worth", d(0), d(6), "30d", TODAY)
            with pytest.raises(ValueError):
                await history.explain(db, "net_worth", "2020-01-01", d(0), "30d", TODAY)
            assert await history.explain(db, "account:nope", d(6), d(0), "30d", TODAY) is None
        finally:
            await db.close()


class TestApi:
    async def test_endpoints(self, client, auth):
        r = await client.get("/api/history?keys=net_worth,saved&range=90d", headers=auth)
        assert r.status_code == 200 and [s["key"] for s in r.json()["series"]] == ["net_worth", "saved"]
        assert {"key": "open_todos", "label": "Open to-dos"} in r.json()["available"]
        assert (await client.get("/api/history?range=5y", headers=auth)).status_code == 422
        assert (await client.get("/api/history/explain?key=net_worth&start=nope&end=2026-10-01", headers=auth)).status_code == 422
        assert (await client.get("/api/history/explain?key=saved&start=2026-09-01&end=2026-10-01", headers=auth)).status_code == 422
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
