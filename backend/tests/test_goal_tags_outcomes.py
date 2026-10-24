async def test_goal_tags_round_trip(client, auth):
    goal = {"id": "g1", "title": "Healthy Body", "color": "#6f8168", "created_at": "2026-01-01"}
    await client.post("/api/goals", json=goal, headers=auth)
    assert (await client.get("/api/goals", headers=auth)).json()[0]["tags"] == ""
    await client.patch("/api/goals/g1", json={"tags": "gym, swim"}, headers=auth)
    assert (await client.get("/api/goals", headers=auth)).json()[0]["tags"] == "gym, swim"


async def test_outcomes_history_lists_non_empty_weeks_newest_first(client, auth):
    for week, text in [("2026-09-28", "ship it"), ("2026-10-05", "rest"), ("2026-10-12", "  ")]:
        await client.put("/api/todos/outcomes", json={"week_str": week, "text": text}, headers=auth)
    rows = (await client.get("/api/todos/outcomes", headers=auth)).json()
    assert [r["week_str"] for r in rows] == ["2026-10-05", "2026-09-28"]
    # The per-week route still resolves alongside the list route.
    assert (await client.get("/api/todos/outcomes/2026-10-05", headers=auth)).json() == {"text": "rest"}


async def test_reviews_are_kept_apart_from_outcomes(client, auth):
    await client.put("/api/todos/outcomes", json={"week_str": "2026-10-12", "text": "Finish draft"}, headers=auth)
    await client.put("/api/todos/reviews", json={"week_str": "2026-10-12", "text": "Draft done, slept badly"}, headers=auth)
    await client.put("/api/todos/reviews", json={"week_str": "2026-10-05", "text": "  "}, headers=auth)
    assert (await client.get("/api/todos/reviews/2026-10-12", headers=auth)).json() == {"text": "Draft done, slept badly"}
    assert (await client.get("/api/todos/outcomes/2026-10-12", headers=auth)).json() == {"text": "Finish draft"}
    assert (await client.get("/api/todos/reviews/2026-10-19", headers=auth)).json() == {"text": ""}
    assert [r["week_str"] for r in (await client.get("/api/todos/reviews", headers=auth)).json()] == ["2026-10-12"]


async def test_agent_reads_reviews_with_outcomes(client, auth):
    import mcp_server
    db = await mcp_server._db()
    await client.put("/api/todos/outcomes", json={"week_str": "2026-10-05", "text": "Rest"}, headers=auth)
    await client.put("/api/todos/outcomes", json={"week_str": "2026-10-12", "text": "Finish draft"}, headers=auth)
    await client.put("/api/todos/reviews", json={"week_str": "2026-10-12", "text": "Good week"}, headers=auth)
    try:
        rows = await mcp_server._dispatch("get_week_reviews", {"limit": 2}, db)
    finally:
        await db.close()
    assert rows == [{"week": "2026-10-12", "outcomes": "Finish draft", "review": "Good week"},
                    {"week": "2026-10-05", "outcomes": "Rest", "review": ""}]
