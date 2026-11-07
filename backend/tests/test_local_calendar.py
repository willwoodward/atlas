async def test_local_event_can_be_moved(client, auth):
    ev = {"id": "e1", "title": "Read", "date": "2026-10-20", "start_h": 9, "end_h": 10}
    await client.post("/api/calendar", json=ev, headers=auth)
    r = await client.patch("/api/calendar/e1", json={"date": "2026-10-21", "start_h": 14.5, "end_h": 15.5}, headers=auth)
    assert r.status_code == 200
    [row] = (await client.get("/api/calendar", headers=auth)).json()
    assert (row["date"], row["start_h"], row["end_h"], row["title"]) == ("2026-10-21", 14.5, 15.5, "Read")


async def test_local_all_day_event_is_kept_as_all_day(client, auth):
    await client.post("/api/calendar", json={"id": "a1", "title": "Holiday", "date": "2026-10-20", "all_day": True}, headers=auth)
    await client.post("/api/calendar", json={"id": "a2", "title": "Read", "date": "2026-10-20", "start_h": 9, "end_h": 10}, headers=auth)
    rows = {r["id"]: r for r in (await client.get("/api/calendar", headers=auth)).json()}
    assert rows["a1"]["all_day"] == 1
    assert rows["a2"]["all_day"] == 0

