"""Saved browser workflows: validation, storage, tools and routes."""
import pytest

import browser_workflows as bw

STEPS = [
    {"do": "open", "url": "https://journeyplanner.irishrail.ie/webapp/?S0G={{from}}&Z0G={{to}}&date={{date}}"},
    {"do": "click", "target": {"role": "button", "name": "Reject All"}, "optional": True},
    {"do": "decide", "goal": "Pick the fare for the train nearest {{time}}", "max_actions": 4},
    {"do": "click", "target": {"role": "button", "name": "Book Tickets"}, "expect": "Seat Selection"},
    {"do": "handoff"},
]
PARAMS = [{"name": "from"}, {"name": "to"}, {"name": "date", "description": "DD/MM/YYYY"}, {"name": "time"}]


async def _db():
    import mcp_server
    return await mcp_server._db()


def test_validation_accepts_a_good_workflow():
    params, steps = bw.validate(PARAMS, STEPS)
    assert [p["name"] for p in params] == ["from", "to", "date", "time"]
    assert steps[1] == {"do": "click", "target": {"role": "button", "name": "Reject All"}, "optional": True}


@pytest.mark.parametrize("steps,params,message", [
    ([{"do": "teleport"}], [], "'do' must be one of"),
    ([{"do": "click"}], [], "needs 'target'"),
    ([{"do": "click", "target": {"role": "button"}}], [], "target needs a name"),
    ([{"do": "click", "target": {"name": "("}, "match": "regex"}], [], None),  # match outside target is ignored
    ([{"do": "click", "target": {"name": "(", "match": "regex"}}], [], "bad regex"),
    ([{"do": "press", "key": "Control+A"}], [], "key must be one of"),
    ([{"do": "open", "url": "http://x.ie"}], [], "https://"),
    ([{"do": "type", "target": {"name": "From"}, "text": "{{origin}}"}], [{"name": "from"}], "no param called 'origin'"),
    ([], [], "non-empty"),
    ([{"do": "handoff"}], [{"name": "From Station"}], "Bad param"),
    ([{"do": "type", "target": {"name": "From"}, "text": "{{ from station }}"}], [{"name": "from"}], "unreadable placeholder"),
    ([{"do": "type", "target": {"name": "From"}, "text": "{{params.origin}}"}], [{"name": "from"}], "no param called 'origin'"),
])
def test_validation_says_what_is_wrong(steps, params, message):
    if message is None:
        bw.validate(params, steps)
        return
    with pytest.raises(ValueError, match=message):
        bw.validate(params, steps)


async def test_tools_round_trip():
    db = await _db()
    try:
        saved = await bw.dispatch("save_workflow", {"name": "Book an Irish Rail train", "site": "IrishRail.ie",
                                                     "description": "Any Irish Rail journey", "params": PARAMS, "steps": STEPS}, db)
        assert saved == {"ok": True, "name": "Book an Irish Rail train", "steps": 5, "params": ["from", "to", "date", "time"]}

        listed = await bw.dispatch("list_workflows", {}, db)
        assert listed[0]["site"] == "irishrail.ie" and listed[0]["steps"] == 5 and listed[0]["runs"] == 0

        got = await bw.dispatch("get_workflow", {"name": "book an irish rail train"}, db)
        assert got["steps"][2]["goal"].startswith("Pick the fare")

        # Saving again under the same name replaces it.
        await bw.dispatch("save_workflow", {"name": "Book an Irish Rail train", "site": "irishrail.ie",
                                            "params": PARAMS, "steps": STEPS[:2] + STEPS[3:]}, db)
        assert len((await bw.get(db, "Book an Irish Rail train"))["steps"]) == 4

        await bw.dispatch("log_workflow_run", {"name": "Book an Irish Rail train", "result": "handed over"}, db)
        got = await bw.get(db, "Book an Irish Rail train")
        assert got["runs"] == 1 and got["last_result"] == "handed over"

        bad = await bw.dispatch("save_workflow", {"name": "x", "site": "irishrail.ie", "params": [], "steps": [{"do": "click"}]}, db)
        assert "needs 'target'" in bad["error"]
        assert "No workflow" in (await bw.dispatch("get_workflow", {"name": "nope"}, db))["error"]

        assert (await bw.dispatch("delete_workflow", {"name": "BOOK AN IRISH RAIL TRAIN"}, db)) == {"ok": True}
        assert await bw.all_workflows(db) == []
    finally:
        await db.close()


async def test_tools_are_listed_and_routes_work(client, auth):
    import mcp_server
    names = {t.name for t in await mcp_server.list_tools()}
    assert {"save_workflow", "list_workflows", "get_workflow", "delete_workflow"} <= names

    db = await _db()
    try:
        await bw.save(db, "Book a train", "irishrail.ie", "", PARAMS, STEPS)
    finally:
        await db.close()
    got = (await client.get("/api/browser/workflows", headers=auth)).json()
    assert got[0]["name"] == "Book a train" and len(got[0]["steps"]) == 5
    assert (await client.delete("/api/browser/workflows/Book%20a%20train", headers=auth)).json() == {"ok": True}
    assert (await client.get("/api/browser/workflows", headers=auth)).json() == []
    assert (await client.get("/api/browser/workflows")).status_code in (401, 403)


def test_params_prefix_is_accepted_and_empty_fields_are_dropped():
    steps = [{"do": "type", "url": "", "target": {"role": "textbox", "name": "From", "match": "exact", "nth": 0},
              "text": "{{params.from}}", "submit": False, "option": "", "max_actions": 0, "optional": False, "expect": ""}]
    _, clean = bw.validate([{"name": "from"}], steps)
    assert clean == [{"do": "type", "target": {"role": "textbox", "name": "From", "match": "exact", "nth": 0}, "text": "{{params.from}}"}]
