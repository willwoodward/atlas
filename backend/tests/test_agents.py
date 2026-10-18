"""
The Agents page: agents (built-in and your own), their prompts, skills, tool
policies, what a run is sent, and the tools Atlas uses to change them.
"""
import json

import pytest

import agent_config as cfg
import inbox

SKILL = """---
name: Trip planning
description: Use when planning a trip: dates, transport, where to stay.
---

1. Check the calendar for free days first.
2. Price two options for getting there.
"""


async def _db():
    return await inbox.connect()


class TestAgents:
    async def test_the_built_ins_are_listed_first(self, client, auth):
        r = (await client.get("/agents", headers=auth)).json()
        assert [a["id"] for a in r["agents"]] == ["atlas", "researcher", "coder"]
        assert all(a["builtin"] and a["tools"] == {} and a["model"] == "" for a in r["agents"])

    async def test_change_a_built_in(self, client, auth):
        resp = await client.put("/agents/researcher", json={"model": "gpt-6-luna", "reasoning": "medium",
                                                            "tools": {"tavily_search": "on", "web_read": "off"}}, headers=auth)
        assert resp.status_code == 200, resp.text
        a = resp.json()
        assert a["reasoning"] == "medium" and a["tools"] == {"tavily_search": "on", "web_read": "off"}
        assert (await client.put("/agents/researcher", json={"name": "Bob"}, headers=auth)).status_code == 422
        assert (await client.put("/agents/coder", json={"reasoning": "huge"}, headers=auth)).status_code == 422
        assert (await client.put("/agents/coder", json={"tools": {"sandbox_bash": "maybe"}}, headers=auth)).status_code == 422
        assert (await client.delete("/agents/coder", headers=auth)).status_code == 409

    async def test_prompts_are_versioned_and_restorable(self, client, auth):
        assert (await client.get("/agents/researcher", headers=auth)).json()["prompt"] == ""   # built-in
        await client.put("/agents/researcher", json={"prompt": "Research {objective} carefully."}, headers=auth)
        await client.put("/agents/researcher", json={"prompt": "Research {objective} briefly."}, headers=auth)
        a = (await client.get("/agents/researcher", headers=auth)).json()
        assert a["prompt"] == "Research {objective} briefly."
        first = a["prompt_history"][-1]["version"]
        back = (await client.post("/agents/researcher/prompt/restore", json={"version": first}, headers=auth)).json()
        assert back["prompt"] == "Research {objective} carefully."
        builtin = (await client.post("/agents/researcher/prompt/restore", headers=auth)).json()
        assert builtin["prompt"] == ""

    async def test_atlas_prompt_is_the_system_prompt(self, client, auth):
        await client.put("/agents/atlas", json={"prompt": "You are Atlas. Be brief. {today}"}, headers=auth)
        assert (await client.get("/assistant/prompt", headers=auth)).json()["content"] == "You are Atlas. Be brief. {today}"

    async def test_make_and_delete_your_own(self, client, auth):
        resp = await client.post("/agents", json={"name": "Finance analyst", "description": "Looks at money.",
                                                  "prompt": "You analyse spending.", "tools": {"spending_trend": "on"}}, headers=auth)
        assert resp.status_code == 200, resp.text
        a = resp.json()
        assert a["id"] == "finance-analyst" and not a["builtin"] and a["prompt"] == "You analyse spending."
        again = (await client.post("/agents", json={"name": "Finance analyst"}, headers=auth)).json()
        assert again["id"] != a["id"]
        assert (await client.post("/agents", json={"name": "  "}, headers=auth)).status_code == 422
        assert (await client.delete(f"/agents/{a['id']}", headers=auth)).json() == {"ok": True}
        assert (await client.get(f"/agents/{a['id']}", headers=auth)).status_code == 404

    async def test_needs_a_token(self, client):
        assert (await client.get("/agents")).status_code == 401
        assert (await client.get("/agents/skills/x")).status_code == 401


class TestSkills:
    async def test_create_edit_restore_delete(self, client, auth):
        s = (await client.post("/agents/skills", json={"content": SKILL}, headers=auth)).json()
        assert s["id"] == "trip-planning" and s["description"].startswith("Use when planning")
        await client.put("/agents/researcher", json={"skills": ["trip-planning"]}, headers=auth)
        edited = SKILL.replace("two options", "three options")
        assert (await client.put(f"/agents/skills/{s['id']}", json={"content": edited}, headers=auth)).status_code == 200
        full = (await client.get(f"/agents/skills/{s['id']}", headers=auth)).json()
        assert "three options" in full["content"] and len(full["history"]) == 2
        back = (await client.post(f"/agents/skills/{s['id']}/restore", json={"version": full["history"][-1]["version"]}, headers=auth)).json()
        assert "two options" in back["content"]
        assert (await client.delete(f"/agents/skills/{s['id']}", headers=auth)).json() == {"ok": True}
        # The agent that had it doesn't any more.
        assert (await client.get("/agents/researcher", headers=auth)).json()["skills"] == []

    async def test_a_skill_needs_frontmatter(self, client, auth):
        assert (await client.post("/agents/skills", json={"content": "Just do it."}, headers=auth)).status_code == 422
        no_desc = "---\nname: X\n---\nSteps."
        assert (await client.post("/agents/skills", json={"content": no_desc}, headers=auth)).status_code == 422

    async def test_unknown_skills_are_refused(self, client, auth):
        assert (await client.put("/agents/coder", json={"skills": ["nope"]}, headers=auth)).status_code == 422

    def test_parse(self):
        assert cfg.parse_skill(SKILL)[:2] == ("Trip planning", "Use when planning a trip: dates, transport, where to stay.")
        assert cfg.parse_skill(cfg.skill_template("A", "B", "C")) == ("A", "B", "C")


class TestRunConfig:
    async def test_what_a_run_is_sent(self, client, auth):
        await client.post("/agents/skills", json={"content": SKILL}, headers=auth)
        await client.put("/agents/atlas", json={"skills": ["trip-planning"], "tools": {"delete_todo": "ask"}}, headers=auth)
        await client.post("/agents", json={"name": "Analyst", "description": "Money", "prompt": "Hi", "tools": {"list_todos": "on"}}, headers=auth)
        off = (await client.post("/agents", json={"name": "Paused"}, headers=auth)).json()
        await client.put(f"/agents/{off['id']}", json={"enabled": False}, headers=auth)
        db = await _db()
        try:
            rc = await cfg.run_config(db)
        finally:
            await db.close()
        assert rc["atlas"]["tools"] == {"delete_todo": "ask"} and "prompt" not in rc["atlas"]
        assert rc["atlas"]["skills"][0]["name"] == "Trip planning" and rc["atlas"]["skills"][0]["body"].startswith("1. Check")
        assert rc["researcher"]["prompt"] == ""
        assert [c["name"] for c in rc["custom"]] == ["Analyst"]
        assert rc["custom"][0]["prompt"] == "Hi" and rc["custom"][0]["tools"] == {"list_todos": "on"}

    async def test_runs_carry_it(self, client, auth, monkeypatch):
        import routers.assistant as assistant
        seen = []

        async def fake_drive(run_id, body, auth_):
            seen.append(json.loads(body))
            db = await assistant._connect()
            await assistant._finish(db, run_id, "done", reply="ok")
            await db.close()
        monkeypatch.setattr(assistant, "_drive_run", fake_drive)
        await client.post("/assistant/runs", json={"message": "hi"}, headers=auth)
        import asyncio
        for _ in range(50):
            if seen:
                break
            await asyncio.sleep(0.02)
        assert set(seen[0]["agents"]) >= {"atlas", "researcher", "coder", "custom"}
        assistant._tasks.clear()


class TestPolicies:
    """Tool policies reach the dashboard: in a routine, "ask" tools become
    suggestions and "off" ones are refused."""

    async def test_ask_and_off(self, client, auth):
        import mcp_server
        db = await _db()
        try:
            await db.execute("INSERT INTO agent_runs (id, created_at, updated_at, session_id) VALUES ('r1','x','x','s1')")
            await db.commit()
            inbox.RUN_CONTEXT.set({"run_id": "r1", "approval": "auto", "ask": {"add_todo"}, "off": {"delete_todo"}})
            out = await mcp_server.run_tool("delete_todo", {"id": "x"}, db)
            assert "switched off" in out["error"]
            out = await mcp_server.run_tool("add_todo", {"text": "Call mum", "bucket": "Today"}, db)
            assert out["proposed"] is True
            async with db.execute("SELECT COUNT(*) FROM todos") as c:
                assert (await c.fetchone())[0] == 0
        finally:
            inbox.RUN_CONTEXT.set(None)
            await db.close()


class TestAtlasTools:
    async def test_atlas_can_make_and_undo(self, client, auth):
        import mcp_server
        db = await _db()
        try:
            out = await mcp_server.run_tool("write_skill", {"content": SKILL}, db)
            assert out["ok"] and out["show"] == {"kind": "skill", "id": "trip-planning"}
            made = await mcp_server.run_tool("create_agent", {"name": "Planner", "description": "Trips", "prompt": "Plan trips.",
                                                              "skills": ["trip-planning"], "tools": {"list_events": "on"}}, db)
            assert made["ok"] and made["show"]["kind"] == "agent"
            upd = await mcp_server.run_tool("update_agent", {"id": "planner", "prompt": "Plan trips well.", "reasoning": "high"}, db)
            assert upd["ok"]
            assert (await cfg.get_agent(db, "planner"))["prompt"] == "Plan trips well."
            import agent_actions
            await agent_actions.undo(db, upd["undo_id"])
            a = await cfg.get_agent(db, "planner")
            assert a["prompt"] == "Plan trips." and a["reasoning"] == ""
            refused = await mcp_server.run_tool("update_agent", {"id": "atlas", "prompt": "x"}, db)
            assert "system prompt" in refused["error"]
            gone = await mcp_server.run_tool("delete_skill", {"id": "trip-planning"}, db)
            await agent_actions.undo(db, gone["undo_id"])
            assert (await cfg.get_agent(db, "planner"))["skills"] == ["trip-planning"]
        finally:
            await db.close()

    def test_changing_agents_is_a_write(self):
        assert cfg.WRITES <= inbox.WRITE_TOOLS


class TestApprovalWording:
    """An "ask first" card says what it would do in words, not ids."""

    async def test_the_driver_adds_a_summary(self, client, auth, monkeypatch):
        import httpx
        import routers.assistant as assistant
        db = await _db()
        await db.execute("INSERT INTO todos (id, text, bucket, created_at) VALUES ('t1','Renew passport','today','x')")
        await db.execute("INSERT INTO agent_runs (id, created_at, updated_at) VALUES ('r9','x','x')")
        await db.commit()
        await db.close()
        stream = "".join(f"data: {json.dumps(e)}\n\n" for e in [
            {"type": "question", "kind": "approval", "questionId": "q1", "question": "Atlas wants to use delete_todo",
             "options": ["Approve", "Reject"], "tool": "delete_todo", "input": {"id": "t1"}},
            {"type": "done"}])
        transport = httpx.MockTransport(lambda req: httpx.Response(200, text=stream))
        real = httpx.AsyncClient
        monkeypatch.setattr(assistant.httpx, "AsyncClient", lambda **kw: real(transport=transport, **kw))
        await assistant._drive_run("r9", b"{}", "Bearer x")
        db = await _db()
        async with db.execute("SELECT payload FROM agent_run_events WHERE run_id='r9' AND type='question'") as c:
            ev = json.loads((await c.fetchone())[0])
        await db.close()
        assert ev["summary"] == "Delete to-do “Renew passport”"

    async def test_agent_changes_in_words(self):
        db = await _db()
        try:
            assert await inbox.describe(db, "update_agent", {"id": "atlas", "tools": {}}) == "Change the agent “atlas” (tools)"
            assert await inbox.describe(db, "write_skill", {"content": SKILL}) == "Write the skill “Trip planning”"
        finally:
            await db.close()
