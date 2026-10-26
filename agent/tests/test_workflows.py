"""The workflow runner, with the browser and the model faked."""
import pytest

import workflows as wf

WORKFLOW = {
    "name": "Book a train", "site": "irishrail.ie",
    "params": [{"name": "from"}, {"name": "to"}, {"name": "date"}, {"name": "time"}],
    "steps": [
        {"do": "open", "url": "https://journeyplanner.irishrail.ie/webapp/?S0G={{from}}&Z0G={{to}}&date={{date}}"},
        {"do": "click", "target": {"role": "button", "name": "Reject All"}, "optional": True},
        {"do": "decide", "goal": "Pick the fare for the train nearest {{time}}"},
        {"do": "click", "target": {"role": "button", "name": "Book Tickets"}, "expect": "Seat Selection"},
        {"do": "handoff"},
    ],
}
VALUES = {"from": "Dublin Connolly", "to": "Belfast Grand Central", "date": "30/10/2026", "time": "09:30"}


class Fake:
    def __init__(self, fail=None, decide_ok=True):
        self.calls, self.decisions, self.fail, self.decide_ok = [], [], fail or {}, decide_ok

    async def call(self, name, args):
        self.calls.append((name, args))
        if name == "get_workflow":
            return WORKFLOW if args["name"] == "Book a train" else {"error": "No workflow called that"}
        if name == "log_workflow_run":
            return {"ok": True}
        key = (name, (args.get("target") or {}).get("name") or args.get("text"))
        if key in self.fail:
            return {"error": self.fail[key]}
        return {"url": "https://x", "snapshot": f"page after {name}"}

    async def decide(self, goal, values, page, limit, handoff=False):
        self.decisions.append((goal, handoff, limit))
        if not self.decide_ok:
            return {"ok": False, "note": "No trains near that time"}
        return {"ok": True, "note": "Handed over" if handoff else "09:50, YA fare"}

    def runner(self):
        return wf.Runner(self.call, self.decide)


async def test_runs_every_step_and_hands_over():
    f = Fake(fail={("browser_click", "Reject All"): "Not found: no button \"Reject All\" on the page."})
    out = await f.runner().run("Book a train", VALUES)
    assert out["status"] == "handed_over" and out["steps_run"] == 5
    names = [c[0] for c in f.calls]
    assert names == ["get_workflow", "browser_open", "browser_click", "browser_click", "browser_expect", "log_workflow_run"]
    # Values are filled in, and URL-encoded inside the URL.
    assert f.calls[1][1]["url"].endswith("S0G=Dublin%20Connolly&Z0G=Belfast%20Grand%20Central&date=30%2F10%2F2026")
    assert f.decisions == [("Pick the fare for the train nearest 09:30", False, 6), ("Hand the page to the user.", True, 6)]
    assert f.calls[-1] == ("log_workflow_run", {"name": "Book a train", "result": "handed over"})
    assert out["notes"] == ["Step 3: 09:50, YA fare", "Step 5: Handed over"]


async def test_a_failed_step_stops_with_the_page_for_atlas():
    f = Fake(fail={("browser_click", "Book Tickets"): "Couldn't click it: something is covering it (ni-notice)."})
    out = await f.runner().run("Book a train", VALUES)
    assert out["status"] == "stopped"
    assert out["stopped_at"]["step"] == 4 and out["stopped_at"]["definition"]["target"]["name"] == "Book Tickets"
    assert "covering it" in out["error"]
    assert out["page"]["snapshot"] == "page after browser_snapshot"
    assert "save_workflow" in out["next"]
    assert f.calls[-2][0] == "log_workflow_run" and f.calls[-2][1]["result"].startswith("stopped at step 4")


async def test_a_required_step_that_is_missing_stops_too():
    f = Fake(fail={("browser_click", "Book Tickets"): "Not found: no button \"Book Tickets\" on the page."})
    out = await f.runner().run("Book a train", VALUES)
    assert out["status"] == "stopped" and out["stopped_at"]["step"] == 4


async def test_expect_failing_stops():
    f = Fake(fail={("browser_expect", "Seat Selection"): "Not found: the page never showed \"Seat Selection\"."})
    out = await f.runner().run("Book a train", VALUES)
    assert out["status"] == "stopped" and "Seat Selection" in out["error"]


async def test_a_decision_that_fails_stops():
    f = Fake(decide_ok=False)
    out = await f.runner().run("Book a train", VALUES)
    assert out["status"] == "stopped" and out["stopped_at"]["do"] == "decide"
    assert out["error"] == "No trains near that time"


async def test_missing_values_and_unknown_workflows():
    f = Fake()
    out = await f.runner().run("Book a train", {"from": "Dublin Connolly"})
    assert out["status"] == "error" and "to, date, time" in out["error"]
    assert (await f.runner().run("Nope", {}))["status"] == "error"
    assert [c[0] for c in f.calls] == ["get_workflow", "get_workflow"]


def test_verdicts():
    assert wf._verdict("I picked it.\nDONE: 09:50, YA fare applied") == {"ok": True, "note": "09:50, YA fare applied"}
    assert wf._verdict("FAILED: sold out")["ok"] is False
    assert wf._verdict("") == {"ok": False, "note": "It gave up without saying why."}


def test_parse_mcp_results():
    assert wf._parse({"status": "success", "content": [{"text": '{"url": "x"}'}]}) == {"url": "x"}
    assert wf._parse({"status": "error", "content": [{"text": "boom"}]}) == {"error": "boom"}
    assert wf._parse({"status": "success", "content": [{"text": "[1, 2]"}]}) == {"result": [1, 2]}


class Event:
    def __init__(self, name):
        self.tool_use, self.cancel_tool = {"name": name}, False


def test_budget_counts_actions_not_looking():
    b = wf._Budget(2)
    events = [Event(n) for n in ("browser_snapshot", "browser_click", "browser_screenshot", "browser_type", "browser_click")]
    for e in events:
        b._before(e)
    assert [bool(e.cancel_tool) for e in events] == [False, False, False, False, True]


def test_fill_accepts_the_params_prefix():
    assert wf.fill("{{params.from}} to {{ to }}", {"from": "Dublin Connolly", "to": "Belfast"}) == "Dublin Connolly to Belfast"
    assert wf.fill_step({"do": "click", "target": {"name": "{{params.from}}"}}, {"from": "Cork"})["target"]["name"] == "Cork"
    assert wf.fill("https://x/?a={{params.q}}", {"q": "a b/c"}, url=True) == "https://x/?a=a%20b%2Fc"


async def test_resume_from_a_later_step():
    f = Fake()
    out = await f.runner().run("Book a train", VALUES, start_at=4)
    assert out["status"] == "handed_over" and out["steps_run"] == 2
    names = [c[0] for c in f.calls]
    assert names == ["get_workflow", "browser_click", "browser_expect", "browser_snapshot", "log_workflow_run"] or "browser_open" not in names
    assert "browser_open" not in names
    assert f.decisions == [("Hand the page to the user.", True, 6)]
    bad = await f.runner().run("Book a train", VALUES, start_at=9)
    assert bad["status"] == "error" and "past the end" in bad["error"]


async def test_stopped_run_says_how_to_continue():
    f = Fake(fail={("browser_click", "Book Tickets"): "Not found: no button \"Book Tickets\" on the page."})
    out = await f.runner().run("Book a train", VALUES)
    assert "start_at=5" in out["next"] and "start_at=4" in out["next"]


async def test_optional_steps_do_not_wait_long():
    f = Fake()
    await f.runner().run("Book a train", VALUES)
    optional = next(a for n, a in f.calls if n == "browser_click" and a["target"]["name"] == "Reject All")
    required = next(a for n, a in f.calls if n == "browser_click" and a["target"]["name"] == "Book Tickets")
    assert optional["wait"] == 1 and "wait" not in required
