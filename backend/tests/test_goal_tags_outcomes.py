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
