"""
The inbox: routines, background runs, suggested changes, replies, push.

The agent is stubbed by a fake driver that does what a background run would:
calls tools through mcp_server.run_tool on a connection carrying the run's
approval mode, then finishes with a reply.
"""
import asyncio
import json
from datetime import datetime, timezone

import pytest

import inbox


@pytest.fixture
def agent(monkeypatch):
    """A stand-in agent. Set `agent.tools` to the calls it should make."""
    import routers.assistant as assistant
    import mcp_server

    class Agent:
        tools: list = []
        reply = "Here's your morning. I'd suggest adding **Renew passport** to today."
        bodies: list = []

    async def fake_drive(run_id, body, auth):
        b = json.loads(body)
        Agent.bodies.append({**b, "auth": auth})
        bg = b.get("background") or {}
        if bg:
            inbox.RUN_CONTEXT.set({"run_id": run_id, "approval": bg.get("approval", "auto")})
        db = await assistant._connect()
        try:
            for name, args in Agent.tools:
                await mcp_server.run_tool(name, args, db)
            await assistant._finish(db, run_id, "done", reply=Agent.reply)
        finally:
            inbox.RUN_CONTEXT.set(None)
            await db.close()

    monkeypatch.setattr(assistant, "_drive_run", fake_drive)
    Agent.tools, Agent.bodies = [], []
    yield Agent
    assistant._tasks.clear()


async def _settle():
    """Let background runs finish."""
    import routers.assistant as assistant
    for _ in range(50):
        tasks = [t for t in assistant._tasks.values() if not t.done()]
        if not tasks:
            await asyncio.sleep(0.01)
            if not [t for t in assistant._tasks.values() if not t.done()]:
                return
        await asyncio.sleep(0.02)


async def _routine(client, auth, **kw):
    body = {"name": "Morning plan", "prompt": "Plan my day.", "days": ["mon", "tue", "wed", "thu", "fri"], "time": "07:30", **kw}
    resp = await client.post("/inbox/routines", json=body, headers=auth)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _todos():
    db = await inbox.connect()
    async with db.execute("SELECT text FROM todos") as c:
        rows = [r[0] for r in await c.fetchall()]
    await db.close()
    return rows


class TestSchedule:
    def test_next_run_is_the_next_matching_day_in_local_time(self):
        # Saturday 17 Oct 2026, 09:00 UTC = 10:00 London (BST): next weekday is Monday.
        after = datetime(2026, 10, 17, 9, 0, tzinfo=timezone.utc)
        nxt = inbox.next_run("mon,tue,wed,thu,fri", "07:30", after)
        local = nxt.astimezone(inbox.TZ)
        assert local.strftime('%a %d %H:%M') == 'Mon 19 07:30'
        assert nxt > after

    def test_it_keeps_local_time_across_the_clocks_changing(self):
        # The clocks go back on Sunday 25 Oct 2026.
        after = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)
        sun = inbox.next_run("sun", "07:30", after)
        assert sun.astimezone(inbox.TZ).strftime("%a %H:%M") == "Sun 07:30"
        assert sun.hour == 7   # GMT again, so 07:30 local is 07:30 UTC

    def test_later_today_counts(self):
        after = datetime(2026, 10, 19, 5, 0, tzinfo=timezone.utc)  # Monday 06:00 London
        assert inbox.next_run("mon", "07:30", after).date().isoformat() == "2026-10-19"

    def test_no_days_means_never(self):
        assert inbox.next_run("", "07:30", datetime.now(timezone.utc)) is None

    def test_schedule_in_words(self):
        assert inbox.describe_schedule("mon,tue,wed,thu,fri", "07:30") == "Weekdays at 07:30"
        assert inbox.describe_schedule("sat,sun", "10:00") == "Weekends at 10:00"


class TestRoutines:
    async def test_create_list_update_delete(self, client, auth):
        r = await _routine(client, auth)
        assert r["schedule"] == "Weekdays at 07:30" and r["approval"] == "ask" and r["next_run_at"]
        listed = (await client.get("/inbox/routines", headers=auth)).json()["routines"]
        assert [x["id"] for x in listed] == [r["id"]]
        upd = (await client.put(f"/inbox/routines/{r['id']}", json={"enabled": False, "time": "8:05"}, headers=auth)).json()
        assert upd["enabled"] is False and upd["time"] == "08:05" and upd["next_run_at"] is None
        assert (await client.delete(f"/inbox/routines/{r['id']}", headers=auth)).json() == {"ok": True}

    async def test_bad_input_is_refused(self, client, auth):
        resp = await client.post("/inbox/routines", json={"name": "x", "prompt": "y", "time": "25:00"}, headers=auth)
        assert resp.status_code == 422
        resp = await client.post("/inbox/routines", json={"name": "x", "prompt": "  "}, headers=auth)
        assert resp.status_code == 422

    async def test_needs_a_token(self, client):
        assert (await client.get("/inbox/routines")).status_code == 401
        assert (await client.get("/inbox")).status_code == 401


class TestBackgroundRuns:
    async def test_a_run_leaves_an_unread_item_with_the_reply(self, client, auth, agent):
        r = await _routine(client, auth)
        item = (await client.post(f"/inbox/routines/{r['id']}/run", headers=auth)).json()
        await _settle()
        body = agent.bodies[0]
        assert body["background"] == {"routine": "Morning plan", "approval": "ask", "trigger": "manual", "test": False}
        assert body["messages"] == [{"role": "user", "content": "Plan my day."}]
        assert body["auth"].startswith("Bearer ")   # a server-minted token, accepted by the agent
        listed = (await client.get("/inbox", headers=auth)).json()
        assert listed["counts"]["unread"] == 1
        got = listed["items"][0]
        assert got["id"] == item["id"] and got["status"] == "done" and got["read"] is False
        assert got["preview"].startswith("Here's your morning. I'd suggest adding Renew passport")

    async def test_changes_in_an_ask_run_wait_for_approval(self, client, auth, agent):
        agent.tools = [("add_todo", {"text": "Renew passport", "bucket": "today"})]
        r = await _routine(client, auth)
        item = (await client.post(f"/inbox/routines/{r['id']}/run", headers=auth)).json()
        await _settle()
        assert await _todos() == []   # nothing done yet
        view = (await client.get(f"/inbox/{item['id']}", headers=auth)).json()
        [p] = view["proposals"]
        assert p["status"] == "pending" and p["summary"] == "Add to-do “Renew passport” to today"
        assert (await client.get("/inbox?view=action", headers=auth)).json()["counts"]["action"] == 1

        done = (await client.post(f"/inbox/proposals/{p['id']}/approve", headers=auth)).json()
        assert done["status"] == "approved" and done["result"]["undo_id"]
        assert await _todos() == ["Renew passport"]
        # Approved changes are undoable like any other.
        undo = await client.post(f"/assistant/actions/{done['result']['undo_id']}/undo", headers=auth)
        assert undo.status_code == 200 and await _todos() == []
        again = await client.post(f"/inbox/proposals/{p['id']}/approve", headers=auth)
        assert again.status_code == 409

    async def test_a_suggestion_can_be_edited_before_approving(self, client, auth, agent):
        agent.tools = [("add_todo", {"text": "Renew pasport", "bucket": "today"})]
        r = await _routine(client, auth)
        item = (await client.post(f"/inbox/routines/{r['id']}/run", headers=auth)).json()
        await _settle()
        p = (await client.get(f"/inbox/{item['id']}", headers=auth)).json()["proposals"][0]
        out = (await client.post(f"/inbox/proposals/{p['id']}/approve", json={"args": {"text": "Renew passport", "bucket": "week"}}, headers=auth)).json()
        assert out["status"] == "approved"
        assert await _todos() == ["Renew passport"]
        p = (await client.get(f"/inbox/{item['id']}", headers=auth)).json()["proposals"][0]
        assert p["summary"] == "Add to-do “Renew passport” to this week"

    async def test_rejecting_changes_nothing(self, client, auth, agent):
        agent.tools = [("add_todo", {"text": "Nope", "bucket": "today"})]
        r = await _routine(client, auth)
        item = (await client.post(f"/inbox/routines/{r['id']}/run", headers=auth)).json()
        await _settle()
        p = (await client.get(f"/inbox/{item['id']}", headers=auth)).json()["proposals"][0]
        assert (await client.post(f"/inbox/proposals/{p['id']}/reject", headers=auth)).json()["status"] == "rejected"
        assert await _todos() == []
        assert (await client.get("/inbox", headers=auth)).json()["counts"]["action"] == 0

    async def test_approve_all(self, client, auth, agent):
        agent.tools = [("add_todo", {"text": "A", "bucket": "today"}), ("add_todo", {"text": "B", "bucket": "week"})]
        r = await _routine(client, auth)
        item = (await client.post(f"/inbox/routines/{r['id']}/run", headers=auth)).json()
        await _settle()
        out = (await client.post(f"/inbox/{item['id']}/approve-all", headers=auth)).json()
        assert [x["status"] for x in out["results"]] == ["approved", "approved"]
        assert sorted(await _todos()) == ["A", "B"]

    async def test_auto_routines_act_directly(self, client, auth, agent):
        agent.tools = [("add_todo", {"text": "Water plants", "bucket": "today"})]
        r = await _routine(client, auth, approval="auto")
        item = (await client.post(f"/inbox/routines/{r['id']}/run", headers=auth)).json()
        await _settle()
        assert await _todos() == ["Water plants"]
        assert (await client.get(f"/inbox/{item['id']}", headers=auth)).json()["proposals"] == []

    async def test_reading_is_allowed_in_an_ask_run(self, client, auth, agent):
        agent.tools = [("list_todos", {})]
        r = await _routine(client, auth)
        item = (await client.post(f"/inbox/routines/{r['id']}/run", headers=auth)).json()
        await _settle()
        assert (await client.get(f"/inbox/{item['id']}", headers=auth)).json()["proposals"] == []

    async def test_a_routine_doesnt_run_twice_at_once(self, client, auth, monkeypatch):
        import routers.assistant as assistant

        async def never(run_id, body, auth):
            await asyncio.sleep(3600)
        monkeypatch.setattr(assistant, "_drive_run", never)
        r = await _routine(client, auth)
        assert (await client.post(f"/inbox/routines/{r['id']}/run", headers=auth)).status_code == 200
        assert (await client.post(f"/inbox/routines/{r['id']}/run", headers=auth)).status_code == 409
        for t in assistant._tasks.values():
            t.cancel()
        assistant._tasks.clear()

    async def test_inbox_threads_stay_out_of_the_chat(self, client, auth, agent):
        r = await _routine(client, auth)
        await client.post(f"/inbox/routines/{r['id']}/run", headers=auth)
        await _settle()
        assert (await client.get("/assistant/sessions/current", headers=auth)).json()["session"] is None
        assert (await client.get("/assistant/sessions", headers=auth)).json()["sessions"] == []


class TestThreads:
    async def test_replying_continues_the_thread_and_acts_directly(self, client, auth, agent):
        r = await _routine(client, auth)
        item = (await client.post(f"/inbox/routines/{r['id']}/run", headers=auth)).json()
        await _settle()
        agent.tools = [("add_todo", {"text": "Book dentist", "bucket": "week"})]
        agent.reply = "Done — added it to this week."
        out = await client.post(f"/inbox/{item['id']}/reply", json={"message": "Also add the dentist"}, headers=auth)
        assert out.status_code == 200
        await _settle()
        body = agent.bodies[-1]
        assert "background" not in body
        assert [m["content"] for m in body["messages"]] == ["Plan my day.", "Here's your morning. I'd suggest adding **Renew passport** to today.", "Also add the dentist"]
        assert await _todos() == ["Book dentist"]
        view = (await client.get(f"/inbox/{item['id']}", headers=auth)).json()
        assert [m["role"] for m in view["messages"]] == ["user", "assistant", "user", "assistant"]
        assert view["read"] is True   # you were there for the reply

    async def test_read_and_archive(self, client, auth, agent):
        r = await _routine(client, auth)
        item = (await client.post(f"/inbox/routines/{r['id']}/run", headers=auth)).json()
        await _settle()
        out = (await client.patch(f"/inbox/{item['id']}", json={"read": True}, headers=auth)).json()
        assert out["counts"]["unread"] == 0
        await client.patch(f"/inbox/{item['id']}", json={"archived": True}, headers=auth)
        assert (await client.get("/inbox", headers=auth)).json()["items"] == []
        assert len((await client.get("/inbox?view=archived", headers=auth)).json()["items"]) == 1


class TestScheduler:
    async def test_due_routines_start_and_are_rescheduled(self, client, auth, agent):
        r = await _routine(client, auth)
        db = await inbox.connect()
        due = datetime.now(timezone.utc).replace(microsecond=0)
        await db.execute("UPDATE routines SET next_run_at=? WHERE id=?", (due.isoformat(), r["id"]))
        await db.commit()
        await db.close()
        assert await inbox.run_due() == [r["id"]]
        await _settle()
        again = (await client.get("/inbox/routines", headers=auth)).json()["routines"][0]
        assert again["next_run_at"] > due.isoformat() and again["last_run_at"]
        assert len((await client.get("/inbox", headers=auth)).json()["items"]) == 1

    async def test_a_long_missed_slot_is_skipped_not_run_late(self, client, auth, agent):
        r = await _routine(client, auth)
        db = await inbox.connect()
        await db.execute("UPDATE routines SET next_run_at=? WHERE id=?", ("2026-01-05T07:30:00+00:00", r["id"]))
        await db.commit()
        await db.close()
        assert await inbox.run_due() == []
        assert (await client.get("/inbox/routines", headers=auth)).json()["routines"][0]["next_run_at"] > "2026-01-06"


class TestRoutineTools:
    async def test_atlas_can_set_up_a_routine_and_undo_it(self, client, auth):
        import mcp_server
        db = await inbox.connect()
        try:
            out = await mcp_server.run_tool("create_routine", {"name": "Money check", "prompt": "Review spending.", "days": ["sun"], "time": "18:00"}, db)
            assert out["routine"]["schedule"] == "Sun at 18:00" and out["undo_id"]
            assert out["show"] == {"kind": "routine", "id": out["routine"]["id"]}
        finally:
            await db.close()
        assert len((await client.get("/inbox/routines", headers=auth)).json()["routines"]) == 1
        await client.post(f"/assistant/actions/{out['undo_id']}/undo", headers=auth)
        assert (await client.get("/inbox/routines", headers=auth)).json()["routines"] == []

    async def test_the_tools_are_listed(self):
        import mcp_server
        names = {t.name for t in await mcp_server.list_tools()}
        assert {"create_routine", "list_routines", "run_routine"} <= names


class TestPush:
    async def test_subscribe_and_send(self, client, auth, monkeypatch):
        import push
        sent = []
        monkeypatch.setattr(push, "_send", lambda sub, payload, pem: sent.append((sub["endpoint"], json.loads(payload))))
        key = (await client.get("/inbox/push/key", headers=auth)).json()["key"]
        assert len(key) > 80
        sub = {"endpoint": "https://push.example/abc", "keys": {"p256dh": "p", "auth": "a"}}
        assert (await client.post("/inbox/push/subscribe", json=sub, headers=auth)).json() == {"ok": True}
        assert (await client.post("/inbox/push/status", json={"endpoint": sub["endpoint"]}, headers=auth)).json() == {"subscribed": True}
        assert (await client.post("/inbox/push/test", headers=auth)).json() == {"sent": 1}
        assert sent[0][1]["body"] == "Notifications are working."

    async def test_a_finished_run_notifies(self, client, auth, agent, monkeypatch):
        import push
        sent = []
        monkeypatch.setattr(push, "_send", lambda sub, payload, pem: sent.append(json.loads(payload)))
        await client.post("/inbox/push/subscribe", json={"endpoint": "https://push.example/x", "keys": {"p256dh": "p", "auth": "a"}}, headers=auth)
        agent.tools = [("add_todo", {"text": "Renew passport", "bucket": "today"})]
        r = await _routine(client, auth)
        item = (await client.post(f"/inbox/routines/{r['id']}/run", headers=auth)).json()
        await _settle()
        assert sent and sent[0]["title"] == "Morning plan" and sent[0]["body"].endswith("· 1 to approve")
        assert sent[0]["url"] == f"/atlas/?inbox={item['id']}"

    async def test_gone_subscriptions_are_dropped(self, client, auth, monkeypatch):
        import push

        class Gone(Exception):
            response = type("R", (), {"status_code": 410})()

        def boom(sub, payload, pem):
            raise Gone()
        monkeypatch.setattr(push, "_send", boom)
        await client.post("/inbox/push/subscribe", json={"endpoint": "https://push.example/y", "keys": {"p256dh": "p", "auth": "a"}}, headers=auth)
        assert (await client.post("/inbox/push/test", headers=auth)).json() == {"sent": 0}
        assert (await client.post("/inbox/push/status", json={"endpoint": "https://push.example/y"}, headers=auth)).json() == {"subscribed": False}

    async def test_only_https_endpoints(self, client, auth):
        resp = await client.post("/inbox/push/subscribe", json={"endpoint": "http://internal/x", "keys": {"p256dh": "p", "auth": "a"}}, headers=auth)
        assert resp.status_code == 422


def test_previews_are_plain_text():
    assert inbox.preview_of("## Today\n\nA **light** day.\n\n- Renew [passport](https://x.y)") == "Today: A light day. Renew passport"


class TestTestRuns:
    async def test_a_test_run_never_acts_or_notifies(self, client, auth, agent, monkeypatch):
        import push
        sent = []
        monkeypatch.setattr(push, "_send", lambda sub, payload, pem: sent.append(payload))
        await client.post("/inbox/push/subscribe", json={"endpoint": "https://push.example/t", "keys": {"p256dh": "p", "auth": "a"}}, headers=auth)
        agent.tools = [("add_todo", {"text": "Water plants", "bucket": "today"})]
        r = await _routine(client, auth, approval="auto")   # even an "acts itself" routine
        item = (await client.post(f"/inbox/routines/{r['id']}/run?test=1", headers=auth)).json()
        await _settle()
        assert agent.bodies[-1]["background"]["test"] is True and agent.bodies[-1]["background"]["approval"] == "ask"
        assert await _todos() == []
        view = (await client.get(f"/inbox/{item['id']}", headers=auth)).json()
        assert view["test"] is True and len(view["proposals"]) == 1
        assert sent == []
        routine = (await client.get("/inbox/routines", headers=auth)).json()["routines"][0]
        assert routine["last_run_at"] is None   # a test isn't a real run


class TestDeepLinks:
    async def test_show_opens_a_specific_routine_or_item(self):
        import mcp_server, inbox
        db = await inbox.connect()
        try:
            r = await mcp_server.run_tool("show", {"view": "inbox", "routine_id": "r1"}, db)
            assert r["show"] == {"kind": "routine", "id": "r1", "explicit": True}
            r = await mcp_server.run_tool("show", {"view": "inbox", "inbox_item_id": "i1"}, db)
            assert r["show"] == {"kind": "inbox", "id": "i1", "explicit": True}
            r = await mcp_server.run_tool("show", {"view": "notes", "github_path": "ideas/x.md"}, db)
            assert r["show"]["kind"] == "github" and r["show"]["path"] == "ideas/x.md"
        finally:
            await db.close()

    async def test_creating_a_routine_points_at_it(self):
        import mcp_server, inbox
        db = await inbox.connect()
        try:
            out = await mcp_server.run_tool("create_routine", {"name": "Plan", "prompt": "Plan my day."}, db)
            assert out["show"] == {"kind": "routine", "id": out["routine"]["id"]}
            listed = await mcp_server.run_tool("list_inbox", {}, db)
            assert listed["items"] == []
        finally:
            await db.close()
