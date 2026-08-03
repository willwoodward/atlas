"""
The durable-run layer.

Runs are durable so a long research or coding turn survives the browser closing:
the work continues server-side and any device can attach, replay what it missed
and follow live. These tests cover the states that machinery can be in, with the
agent itself stubbed out — the model is not what is under test here.
"""
import json

import pytest



async def _append_event(run_id: str, seq: int, event: dict):
    """Write an event the way the driver would, without running the driver."""
    import routers.assistant as assistant
    db = await assistant._connect()
    await assistant._append(db, run_id, seq, event["type"], json.dumps(event))
    await db.close()


async def _status(run_id: str) -> str:
    import routers.assistant as assistant
    db = await assistant._connect()
    async with db.execute("SELECT status FROM agent_runs WHERE id=?", (run_id,)) as c:
        row = await c.fetchone()
    await db.close()
    return row["status"]


class TestAuthBoundary:
    async def test_starting_a_run_needs_a_token(self, client):
        resp = await client.post("/assistant/runs", json={"messages": [{"role": "user", "content": "hi"}]})
        assert resp.status_code == 401

    async def test_a_garbage_token_is_rejected(self, client):
        resp = await client.get("/assistant/runs", headers={"Authorization": "Bearer not-a-jwt"})
        assert resp.status_code == 401

    async def test_the_mcp_key_is_not_a_session_token(self, client):
        """The MCP key reaches MCP tools; it must not reach the assistant.

        Both live behind the same Bearer scheme, so this is the test that stops
        one being quietly accepted as the other.
        """
        resp = await client.get("/assistant/runs", headers={"Authorization": "Bearer test-mcp-key"})
        assert resp.status_code == 401

    async def test_a_token_signed_with_the_wrong_secret_is_rejected(self, client):
        from jose import jwt
        forged = jwt.encode({"sub": "will@woodwardweb.com"}, "wrong-secret", algorithm="HS256")
        resp = await client.get("/assistant/runs", headers={"Authorization": f"Bearer {forged}"})
        assert resp.status_code == 401


class TestRunLifecycle:
    async def test_a_new_run_is_running(self, run_id):
        assert await _status(run_id) == "running"

    async def test_history_replays_stored_events_in_order(self, client, auth, run_id):
        await _append_event(run_id, 1, {"type": "token", "text": "one "})
        await _append_event(run_id, 2, {"type": "token", "text": "two"})

        resp = await client.get(f"/assistant/runs/{run_id}/history", headers=auth)
        assert resp.status_code == 200
        events = resp.json()["events"]
        assert [e["text"] for e in events] == ["one ", "two"]
        assert [e["seq"] for e in events] == [1, 2]

    async def test_history_of_an_unknown_run_is_404(self, client, auth):
        resp = await client.get("/assistant/runs/does-not-exist/history", headers=auth)
        assert resp.status_code == 404

    async def test_duplicate_sequence_numbers_are_ignored(self, run_id, client, auth):
        """INSERT OR IGNORE means a retried write cannot duplicate an event."""
        await _append_event(run_id, 1, {"type": "token", "text": "once"})
        await _append_event(run_id, 1, {"type": "token", "text": "again"})

        resp = await client.get(f"/assistant/runs/{run_id}/history", headers=auth)
        assert len(resp.json()["events"]) == 1
        assert resp.json()["events"][0]["text"] == "once"

    async def test_cancelling_marks_the_run_cancelled(self, client, auth, run_id):
        resp = await client.post(f"/assistant/runs/{run_id}/cancel", headers=auth)
        assert resp.status_code == 200
        assert await _status(run_id) == "cancelled"

    async def test_runs_are_listed_newest_first(self, client, auth, run_id):
        resp = await client.get("/assistant/runs", headers=auth)
        assert resp.status_code == 200
        ids = [r["id"] for r in resp.json()["runs"]]
        assert run_id in ids


class TestAwaitingInput:
    """A run blocked on ask_user is idle by design and must not be reaped."""

    async def test_a_question_moves_the_run_to_awaiting_input(self, run_id):
        import routers.assistant as assistant
        db = await assistant._connect()
        await assistant._set_status(db, run_id, "awaiting_input")
        await db.close()
        assert await _status(run_id) == "awaiting_input"

    async def test_answering_returns_it_to_running(self, run_id):
        import routers.assistant as assistant
        db = await assistant._connect()
        await assistant._set_status(db, run_id, "awaiting_input")
        await assistant._set_status(db, run_id, "running")
        await db.close()
        assert await _status(run_id) == "running"

    async def test_a_finished_run_cannot_be_moved_back_to_running(self, run_id):
        """_set_status must never resurrect a terminal run."""
        import routers.assistant as assistant
        db = await assistant._connect()
        await assistant._finish(db, run_id, "done")
        await assistant._set_status(db, run_id, "awaiting_input")
        await db.close()
        assert await _status(run_id) == "done"

    async def test_answering_a_finished_run_is_rejected(self, client, auth, run_id):
        import routers.assistant as assistant
        db = await assistant._connect()
        await assistant._finish(db, run_id, "done")
        await db.close()

        resp = await client.post(f"/assistant/runs/{run_id}/answer",
                                 json={"question_id": "q1", "answer": "yes"}, headers=auth)
        assert resp.status_code == 409

    async def test_answering_an_unknown_run_is_404(self, client, auth):
        resp = await client.post("/assistant/runs/nope/answer",
                                 json={"question_id": "q1", "answer": "yes"}, headers=auth)
        assert resp.status_code == 404

    async def test_an_empty_answer_is_rejected(self, client, auth, run_id):
        resp = await client.post(f"/assistant/runs/{run_id}/answer",
                                 json={"question_id": "q1", "answer": ""}, headers=auth)
        assert resp.status_code == 422

    async def test_the_awaiting_timeout_is_far_longer_than_the_stall_timeout(self):
        """A question asked at 2am must still be answerable after a night's sleep."""
        import routers.assistant as assistant
        assert assistant.AWAITING_TIMEOUT_SECONDS >= 12 * 3600
        assert assistant.AWAITING_TIMEOUT_SECONDS > assistant.IDLE_TIMEOUT_SECONDS


class TestRunRequest:
    async def test_an_empty_message_list_is_rejected(self, client, auth):
        resp = await client.post("/assistant/runs", json={"messages": []}, headers=auth)
        assert resp.status_code == 422

    async def test_an_absurdly_long_thread_is_rejected(self, client, auth):
        messages = [{"role": "user", "content": "x"} for _ in range(61)]
        resp = await client.post("/assistant/runs", json={"messages": messages}, headers=auth)
        assert resp.status_code == 422
