"""Deleting a to-do takes its sub-tasks with it, so none are left hidden and still "open"."""


async def _add(client, auth, id, parent=None):
    r = await client.post("/api/todos", json={"id": id, "text": id, "bucket": "today", "parent_id": parent,
                                              "done": False, "created_at": "2026-10-20T09:00:00Z"}, headers=auth)
    assert r.status_code == 200, r.text


async def _ids(client, auth):
    return sorted(t["id"] for t in (await client.get("/api/todos", headers=auth)).json())


async def test_deleting_a_todo_deletes_its_sub_tasks(client, auth):
    await _add(client, auth, "a"); await _add(client, auth, "a1", "a"); await _add(client, auth, "b")
    await client.delete("/api/todos/a", headers=auth)
    assert await _ids(client, auth) == ["b"]


async def test_clearing_done_clears_their_sub_tasks_too(client, auth):
    await _add(client, auth, "a"); await _add(client, auth, "a1", "a"); await _add(client, auth, "b"); await _add(client, auth, "b1", "b")
    await client.patch("/api/todos/a/toggle", headers=auth)   # a is done; its sub-task was never ticked
    await client.delete("/api/todos/done/clear", headers=auth)
    assert await _ids(client, auth) == ["b", "b1"]
