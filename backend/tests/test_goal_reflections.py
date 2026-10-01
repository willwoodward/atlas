"""Quarterly goal reflections: one free-form text per 'YYYY-Qn'."""


async def test_reflection_round_trips_and_overwrites(client, auth):
    assert (await client.get("/api/goals/reflections", headers=auth)).json() == []

    await client.put("/api/goals/reflections/2026-Q3", json={"text": "first"}, headers=auth)
    await client.put("/api/goals/reflections/2026-Q3", json={"text": "second"}, headers=auth)

    rows = (await client.get("/api/goals/reflections", headers=auth)).json()
    assert [(r["period"], r["text"]) for r in rows] == [("2026-Q3", "second")]


async def test_quarters_in_different_years_are_separate(client, auth):
    await client.put("/api/goals/reflections/2025-Q4", json={"text": "last year"}, headers=auth)
    await client.put("/api/goals/reflections/2026-Q4", json={"text": "this year"}, headers=auth)

    rows = (await client.get("/api/goals/reflections", headers=auth)).json()
    assert {r["period"]: r["text"] for r in rows} == {"2025-Q4": "last year", "2026-Q4": "this year"}


async def test_rejects_malformed_period(client, auth):
    for bad in ["Q3", "2026-Q5", "2026-q3", "26-Q1"]:
        resp = await client.put(f"/api/goals/reflections/{bad}", json={"text": "x"}, headers=auth)
        assert resp.status_code == 400, bad


async def test_requires_auth(client):
    assert (await client.get("/api/goals/reflections")).status_code == 401
    assert (await client.put("/api/goals/reflections/2026-Q3", json={"text": "x"})).status_code == 401
