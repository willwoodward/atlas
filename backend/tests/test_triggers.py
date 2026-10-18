"""
Routines set off by events (triggers.py): a bank import, a budget passing its
line, the calendar changing. The agent is the inbox tests' stand-in.
"""
from datetime import date, timedelta

import inbox
import triggers
from test_inbox import _settle, agent  # noqa: F401  (the stand-in agent fixture)


async def _routine(client, auth, **kw):
    body = {"name": "Watch", "prompt": "Look into it.", **kw}
    resp = await client.post("/inbox/routines", json=body, headers=auth)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _db():
    return await inbox.connect()


class TestSettings:
    async def test_event_routines_have_no_schedule(self, client, auth):
        r = await _routine(client, auth, trigger="bank_import")
        assert r["trigger"] == "bank_import" and r["schedule"] == "After each bank import" and r["next_run_at"] is None
        b = await _routine(client, auth, trigger="budget", trigger_config={"percent": 90})
        assert b["schedule"] == "When a budget passes 90%"
        c = await _routine(client, auth, trigger="calendar")
        assert c["trigger_config"] == {"days": 2} and c["schedule"] == "When the next 2 days' calendar changes"
        # Back to a schedule: it gets a next run again.
        s = (await client.put(f"/inbox/routines/{c['id']}", json={"trigger": "schedule"}, headers=auth)).json()
        assert s["trigger"] == "schedule" and s["next_run_at"]

    async def test_bad_settings(self, client, auth):
        for body in ({"trigger": "sunrise"}, {"trigger": "budget", "trigger_config": {"percent": 5}},
                     {"trigger": "calendar", "trigger_config": {"days": 40}}):
            resp = await client.post("/inbox/routines", json={"name": "x", "prompt": "y", **body}, headers=auth)
            assert resp.status_code == 422, body

    async def test_the_scheduler_leaves_event_routines_alone(self, client, auth, agent):
        await _routine(client, auth, trigger="bank_import")
        assert await inbox.run_due() == []


class TestBankImport:
    async def test_an_import_sets_it_off_with_what_came_in(self, client, auth, agent):
        db = await _db()
        await db.execute("INSERT INTO finances_accounts (id, name, type, balance, currency) VALUES ('acc1','Wise','checking',0,'EUR')")
        await db.commit()
        await db.close()
        r = await _routine(client, auth, trigger="bank_import")
        rows = [{"external_id": f"x{i}", "date": f"2026-10-1{i}", "merchant": "Tesco", "amount": 10 + i, "currency": "EUR"} for i in range(3)]
        resp = await client.post("/api/finances/import/commit", headers=auth,
                                 json={"source": "wise_csv", "account_id": "acc1", "rows": rows, "auto_categorise": False})
        assert resp.json()["inserted"] == 3
        await _settle()
        msg = agent.bodies[-1]["messages"][-1]["content"]
        assert msg.startswith("Look into it.") and "What set this off: 3 new transactions imported into Wise dated 2026-10-10 to 2026-10-12." in msg
        assert agent.bodies[-1]["background"]["trigger"] == "event:bank_import"
        items = (await client.get("/inbox", headers=auth)).json()["items"]
        assert items[0]["routine_id"] == r["id"]
        # Nothing new, nothing set off.
        n = len(agent.bodies)
        await client.post("/api/finances/import/commit", headers=auth,
                          json={"source": "wise_csv", "account_id": "acc1", "rows": rows, "auto_categorise": False})
        await _settle()
        assert len(agent.bodies) == n


class TestBudgets:
    async def _spend(self, amount):
        db = await _db()
        today = date.today().isoformat()
        await db.execute("INSERT OR REPLACE INTO finances_budgets (id, category, amount, period, currency, categories) "
                         "VALUES ('b1','Food',100,'monthly','EUR','[\"Groceries\"]')")
        await db.execute("INSERT INTO finances_transactions (id, merchant, category, amount, date, type, currency) "
                         "VALUES (?, 'Tesco', 'Groceries', ?, ?, 'expense', 'EUR')", (f"t{amount}", amount, today))
        await db.commit()
        return db

    async def test_once_per_budget_per_month(self, client, auth, agent):
        await _routine(client, auth, trigger="budget", trigger_config={"percent": 80})
        db = await self._spend(50)
        try:
            assert await triggers.check_budgets(db, force=True) == []      # 50%: fine
            await db.execute("INSERT INTO finances_transactions (id, merchant, category, amount, date, type, currency) "
                             "VALUES ('t2', 'Tesco', 'Groceries', 35, ?, 'expense', 'EUR')", (date.today().isoformat(),))
            await db.commit()
            assert len(await triggers.check_budgets(db, force=True)) == 1  # 85%: tell them
            await _settle()
            msg = agent.bodies[-1]["messages"][-1]["content"]
            assert "The Food budget is at 85% (€85.00 of €100.00), past the 80% line" in msg
            assert await triggers.check_budgets(db, force=True) == []      # already told this month
        finally:
            await db.close()

    async def test_hourly_unless_forced(self, client, auth, agent):
        await _routine(client, auth, trigger="budget")
        db = await self._spend(90)
        try:
            assert len(await triggers.check_budgets(db)) == 1
            await _settle()
            await db.execute("INSERT OR REPLACE INTO finances_budgets (id, category, amount, period, currency, categories) "
                             "VALUES ('b2','Fun',10,'monthly','EUR','[\"Groceries\"]')")
            await db.commit()
            assert await triggers.check_budgets(db) == []   # checked within the hour
        finally:
            await db.close()


class TestCalendar:
    async def _event(self, db, eid, title, day, start=9):
        await db.execute("INSERT OR REPLACE INTO local_events (id, title, date, start_h, end_h) VALUES (?,?,?,?,?)",
                         (eid, title, day, start, start + 1))
        await db.commit()

    async def test_changes_set_it_off(self, client, auth, agent, monkeypatch):
        await _routine(client, auth, trigger="calendar", trigger_config={"days": 2})
        today = date.today()
        db = await _db()
        try:
            await self._event(db, "e1", "Dentist", today.isoformat())
            assert await triggers.check_calendar(db, force=True) == []    # first look: just remember
            assert await triggers.check_calendar(db, force=True) == []    # nothing changed
            await self._event(db, "e1", "Dentist", today.isoformat(), start=14)
            await self._event(db, "e2", "Gym", (today + timedelta(days=1)).isoformat())
            assert len(await triggers.check_calendar(db, force=True)) == 1
            await _settle()
            msg = agent.bodies[-1]["messages"][-1]["content"]
            assert "The calendar for the next 2 days changed:" in msg
            assert "moved “Dentist” to" in msg and "14:00" in msg and "added “Gym”" in msg
            # Another change straight away waits for the gap…
            await db.execute("DELETE FROM local_events WHERE id='e2'")
            await db.commit()
            assert await triggers.check_calendar(db, force=True) == []
            # …and is still noticed once the gap has passed.
            monkeypatch.setattr(triggers, "CALENDAR_GAP", timedelta(0))
            assert len(await triggers.check_calendar(db, force=True)) == 1
            await _settle()
            assert "removed “Gym”" in agent.bodies[-1]["messages"][-1]["content"]
        finally:
            await db.close()

    async def test_a_failed_google_fetch_isnt_a_change(self, client, auth, agent, monkeypatch):
        import mcp_server
        await _routine(client, auth, trigger="calendar")
        db = await _db()
        try:
            await self._event(db, "e1", "Dentist", date.today().isoformat())
            await triggers.check_calendar(db, force=True)

            async def token(_db):
                return "tok"

            async def fails(*a, **k):
                return None
            monkeypatch.setattr(mcp_server, "_gcal_token", token)
            monkeypatch.setattr(mcp_server, "_gcal_events", fails)
            assert await triggers.check_calendar(db, force=True) == []
        finally:
            await db.close()

    def test_yesterday_dropping_off_isnt_a_change(self):
        today = date(2026, 10, 18)
        before = {"local:a": {"title": "Yoga", "date": "2026-10-17", "start": "9", "end": "10"}}
        assert triggers.describe_changes(before, {}, today) == []
        assert triggers.describe_changes({}, {"local:b": {"title": "Run", "date": "2026-10-18", "start": "7.5", "end": "8"}}, today) \
            == ["added “Run” on 2026-10-18"]
