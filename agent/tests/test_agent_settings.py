"""
The Agents page's settings, as the agent service applies them: tool policies,
models, prompts with placeholders, skills, and asking before an "ask" tool.
"""
import asyncio
import os

import pytest

os.environ.setdefault("OPENAI_API_KEY", "test-key")

import agent_settings as s
import questions


class FakeTool:
    def __init__(self, name):
        self.tool_name = name


def names(tools):
    return [s.tool_name(t) for t in tools]


class TestPolicies:
    def test_off_tools_are_left_out(self):
        tools = [FakeTool("list_todos"), FakeTool("delete_todo"), FakeTool("http_request")]
        cfg = {"tools": {"delete_todo": "off", "web_read": "off"}}
        assert names(s.allowed(tools, cfg)) == ["list_todos"]

    def test_your_own_agents_only_get_what_is_switched_on(self):
        tools = [FakeTool("list_todos"), FakeTool("add_todo"), FakeTool("tavily_search")]
        cfg = {"tools": {"list_todos": "on", "add_todo": "ask"}}
        assert names(s.allowed(tools, cfg, default="off")) == ["list_todos", "add_todo"]
        ask, off = s.ask_lists(cfg, default="off", names=["list_todos", "add_todo", "delete_todo"])
        assert "add_todo" in ask and set(s.ALWAYS_ASK) <= set(ask)
        assert off == ["delete_todo"]

    def test_bad_policies_fall_back(self):
        assert s.policy({"tools": {"x": "maybe"}}, "x") == "on"


class TestModel:
    def test_model_and_reasoning(self):
        m = s.build_model({"model": "gpt-other", "reasoning": "low"}, effort="high")
        assert m.config["model_id"] == "gpt-other" and m.config["params"]["reasoning"] == {"effort": "low"}
        d = s.build_model({}, effort="high")
        assert d.config["model_id"] == s.DEFAULT_MODEL and d.config["params"]["reasoning"] == {"effort": "high"}
        spoken = s.build_model({"reasoning": "max"}, force_effort="low")
        assert spoken.config["params"]["reasoning"] == {"effort": "low"}


class TestPrompts:
    def test_fill_replaces_and_keeps_other_braces(self):
        out = s.fill("Look into {objective}. Use {json} as is.", {"objective": "trains"}, required=("objective",))
        assert out == "Look into trains. Use {json} as is."

    def test_dropped_placeholders_are_added_back(self):
        out = s.fill("Be thorough.", {"objective": "trains", "context": ""}, required=("objective", "context"))
        assert out.startswith("Be thorough.") and "Objective:\ntrains" in out and "Context" not in out

    def test_researcher_prompt_from_settings(self, monkeypatch):
        import research
        seen = {}

        class FakeAgent:
            def __init__(self, **kw):
                seen.update(kw)

            async def invoke_async(self, _):
                return "done"
        monkeypatch.setattr(research, "Agent", FakeAgent)
        s.set_settings({"researcher": {"prompt": "Dig into {objective}.", "tools": {"web_read": "off"},
                                       "skills": [{"name": "Sources", "description": "Citing", "body": "Cite."}]}})
        try:
            assert asyncio.run(research._attempt(0, "ferries", "", False)) == "done"
        finally:
            s.set_settings(None)
        assert seen["system_prompt"].startswith("Dig into ferries.") and "load_skill" in seen["system_prompt"]
        assert names(seen["tools"]) == ["tavily_search", "load_skill"]


class TestSkills:
    def test_section_and_tool(self):
        skills = [{"name": "Trip planning", "description": "Planning trips", "body": "1. Check dates."}]
        prompt, tools = s.with_skills("Base.", [], {"skills": skills})
        assert "- Trip planning: Planning trips" in prompt
        load = tools[0]
        assert "1. Check dates." in load("trip planning")
        assert "No skill" in load("other")

    def test_no_skills_no_change(self):
        assert s.with_skills("Base.", ["t"], {}) == ("Base.", ["t"])


class _Event:
    def __init__(self, name, args):
        self.tool_use = {"name": name, "input": args}
        self.cancel_tool = False


@pytest.fixture
def queue():
    from progress import set_progress_queue
    q = asyncio.Queue()
    set_progress_queue(q)
    yield q
    set_progress_queue(None)
    questions._pending.clear()
    questions.set_run_id(None)
    s.set_settings(None)


class TestAskFirst:
    async def test_an_ask_tool_waits_for_approval(self, queue):
        questions.set_run_id("run-1")
        hook = s.ApprovalHook({"tools": {"delete_todo": "ask"}})
        ev = _Event("delete_todo", {"id": "t1"})
        task = asyncio.create_task(hook._before(ev))
        await asyncio.sleep(0.01)
        q = queue.get_nowait()
        assert q["kind"] == "approval" and q["tool"] == "delete_todo" and q["input"] == {"id": "t1"}
        assert q["options"] == ["Approve", "Reject"] and not task.done()
        questions.deliver("run-1", q["questionId"], "Approve")
        await task
        assert ev.cancel_tool is False

    async def test_no_cancels_the_call(self, queue):
        questions.set_run_id("run-1")
        hook = s.ApprovalHook({"tools": {"delete_todo": "ask"}})
        ev = _Event("delete_todo", {"id": "t1"})
        task = asyncio.create_task(hook._before(ev))
        await asyncio.sleep(0.01)
        questions.deliver("run-1", queue.get_nowait()["questionId"], "Reject")
        await task
        assert "said no" in ev.cancel_tool

    async def test_on_tools_dont_ask(self, queue):
        ev = _Event("list_todos", {})
        await s.ApprovalHook({})._before(ev)
        assert ev.cancel_tool is False and queue.empty()

    async def test_changing_agents_always_asks(self, queue):
        questions.set_run_id("run-1")
        ev = _Event("update_agent", {"id": "atlas", "tools": {"delete_todo": "on"}})
        task = asyncio.create_task(s.ApprovalHook({"tools": {"update_agent": "on"}})._before(ev))
        await asyncio.sleep(0.01)
        assert queue.get_nowait()["tool"] == "update_agent"
        task.cancel()

    async def test_in_the_background_dashboard_tools_go_to_the_inbox(self, queue):
        s.set_settings({}, background=True)
        hook = s.ApprovalHook({"tools": {"add_todo": "ask", "delegate_coding": "ask"}}, dashboard={"add_todo"})
        mcp = _Event("add_todo", {"text": "x"})
        await hook._before(mcp)
        assert mcp.cancel_tool is False and queue.empty()   # the dashboard makes it a suggestion
        local = _Event("delegate_coding", {"repo": "r"})
        await hook._before(local)
        assert "background run" in local.cancel_tool


class TestCatalog:
    def test_catalog(self):
        from agent_catalog import catalog
        c = catalog()
        assert c["default_model"] == s.DEFAULT_MODEL
        assert "{objective}" in c["agents"]["researcher"]["prompt"]
        assert {t["name"] for t in c["agents"]["coder"]["tools"]} >= {"sandbox_bash", "commit_work"}


class TestRuntimeWiring:
    """stream_reply with the Agents page's settings: the right tools, skills,
    hooks and MCP headers reach the agent. The model and MCP are faked."""

    def _run(self, monkeypatch, agents, background=None):
        import runtime
        seen, headers = {}, []

        class FakeClient:
            def __init__(self, h):
                headers.append(h)

            def start(self):
                pass

            def list_tools_sync(self):
                return [FakeTool("list_todos"), FakeTool("delete_todo"), FakeTool("add_todo")]

            def stop(self, *a):
                pass

        class FakeAgent:
            def __init__(self, **kw):
                seen.update(kw)

            async def stream_async(self, prompt):
                yield {"data": "ok"}

        def fake_mcp(run_id=None, approval=None, ask=None, off=None):
            return FakeClient({"run": run_id, "approval": approval, "ask": ask, "off": off})
        monkeypatch.setattr(runtime, "_mcp_client", fake_mcp)
        monkeypatch.setattr(runtime, "Agent", FakeAgent)

        async def go():
            return [e async for e in runtime.stream_reply([{"role": "user", "content": "hi"}], "Will", run_id="r1",
                                                         system_prompt="You are Atlas. {today}", agents=agents, background=background)]
        events = asyncio.run(go())
        s.set_settings(None)
        return seen, headers, events

    def test_tools_skills_and_hooks(self, monkeypatch):
        agents = {"atlas": {"model": "gpt-x", "reasoning": "medium", "tools": {"delete_todo": "off", "add_todo": "ask", "tavily_search": "off"},
                            "skills": [{"name": "Trips", "description": "Planning trips", "body": "Steps."}]},
                  "custom": [{"id": "analyst", "name": "Analyst", "description": "Money questions", "prompt": "Hi", "tools": {}}]}
        seen, headers, events = self._run(monkeypatch, agents)
        tools = names(seen["tools"])
        assert "delete_todo" not in tools and "tavily_search" not in tools
        assert {"list_todos", "add_todo", "load_skill", "ask_agent"} <= set(tools)
        assert "- Trips: Planning trips" in seen["system_prompt"]
        assert seen["model"].config["model_id"] == "gpt-x"
        assert any(isinstance(h, s.ApprovalHook) for h in seen["hooks"])
        # A chat asks in the chat, so "ask" isn't sent to the dashboard; "off" is.
        assert headers[0]["ask"] is None and headers[0]["off"] == ["delete_todo", "tavily_search"]
        assert ("token", "ok") in events

    def test_a_routine_sends_ask_to_the_dashboard(self, monkeypatch):
        agents = {"atlas": {"tools": {"add_todo": "ask"}}}
        _, headers, _ = self._run(monkeypatch, agents, background={"routine": "Morning", "approval": "auto"})
        assert "add_todo" in headers[0]["ask"] and "update_agent" in headers[0]["ask"]

    def test_no_settings_is_the_old_behaviour(self, monkeypatch):
        seen, _, _ = self._run(monkeypatch, None)
        assert {"list_todos", "delete_todo", "add_todo", "delegate_research"} <= set(names(seen["tools"]))
        assert "ask_agent" not in names(seen["tools"]) and "load_skill" not in names(seen["tools"])


class TestYourOwnAgents:
    def test_ask_agent_runs_it_with_only_its_tools(self, monkeypatch):
        seen = {}

        class FakeAgent:
            def __init__(self, **kw):
                seen.update(kw)

            async def invoke_async(self, message):
                seen["message"] = message
                return "Spending is up 12% on eating out."
        monkeypatch.setattr(s, "Agent", FakeAgent)
        s.set_settings({"custom": [{"id": "analyst", "name": "Analyst", "description": "Money", "prompt": "Be precise.",
                                    "model": "", "reasoning": "low", "tools": {"spending_trend": "on", "add_todo": "ask"}}]})

        class Client:
            def stop(self, *a):
                seen["stopped"] = True

        async def factory(a):
            seen["factory_for"] = a["id"]
            return Client(), [FakeTool("spending_trend"), FakeTool("add_todo"), FakeTool("delete_todo")]
        try:
            tool = s.ask_agent_tool("Will", factory, lambda: [FakeTool("tavily_search")], "Europe/London", lambda name: [])
            assert "analyst: Analyst — Money" in tool.tool_spec["description"]
            out = asyncio.run(tool._tool_func("analyst", "How's my spending?", "Last 30 days"))
        finally:
            s.set_settings(None)
        assert out == {"agent": "Analyst", "status": "ok", "answer": "Spending is up 12% on eating out."}
        assert names(seen["tools"]) == ["spending_trend", "add_todo"]   # web and delete_todo weren't switched on
        assert seen["system_prompt"].startswith("You are Analyst") and "Be precise." in seen["system_prompt"]
        assert "Last 30 days" in seen["message"] and seen["stopped"]
        assert any(isinstance(h, s.ApprovalHook) for h in seen["hooks"])

    def test_unknown_agent(self, monkeypatch):
        s.set_settings({"custom": [{"id": "analyst", "name": "Analyst"}]})
        try:
            tool = s.ask_agent_tool("Will", None, lambda: [], "Europe/London", lambda n: [])
            assert "No agent" in asyncio.run(tool._tool_func("nobody", "x"))["error"]
        finally:
            s.set_settings(None)
