async def test_local_event_can_be_moved(client, auth):
    ev = {"id": "e1", "title": "Read", "date": "2026-10-20", "start_h": 9, "end_h": 10}
    await client.post("/api/calendar", json=ev, headers=auth)
    r = await client.patch("/api/calendar/e1", json={"date": "2026-10-21", "start_h": 14.5, "end_h": 15.5}, headers=auth)
    assert r.status_code == 200
    [row] = (await client.get("/api/calendar", headers=auth)).json()
    assert (row["date"], row["start_h"], row["end_h"], row["title"]) == ("2026-10-21", 14.5, 15.5, "Read")
