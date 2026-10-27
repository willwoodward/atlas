"""The browser helper relay: auth, round trips, screenshots, site notes."""
import asyncio
import base64
import json

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import browser_helper as bh

KEY = "helper-test-key"


class FakeSocket:
    """Stands in for the helper's WebSocket: answers each command with `reply`."""

    def __init__(self, link, reply):
        self.link, self.reply, self.sent = link, reply, []

    async def send_text(self, text):
        msg = json.loads(text)
        self.sent.append(msg)
        out = self.reply(msg) if callable(self.reply) else self.reply
        if out is not None:
            asyncio.get_running_loop().call_soon(self.link.resolve, {"id": msg["id"], **out})


@pytest.fixture
def link(monkeypatch):
    fresh = bh._Link()
    monkeypatch.setattr(bh, "link", fresh)
    return fresh


async def _db():
    import mcp_server
    return await mcp_server._db()


async def test_offline_tells_the_agent(link):
    db = await _db()
    try:
        out = await bh.dispatch("browser_snapshot", {}, db)
    finally:
        await db.close()
    assert "isn't running" in out["error"]


async def test_round_trip_and_site_notes(link):
    link.ws = FakeSocket(link, {"ok": True, "result": {"site": "irishrail.ie", "url": "https://www.irishrail.ie/", "snapshot": "…"}})
    db = await _db()
    try:
        first = await bh.dispatch("browser_open", {"url": "https://www.irishrail.ie/"}, db)
        assert link.ws.sent[0]["cmd"] == "open" and link.ws.sent[0]["args"] == {"url": "https://www.irishrail.ie/"}
        assert first["site"] == "irishrail.ie" and "none yet" in first["site_notes"]

        saved = await bh.dispatch("save_site_notes", {"site": "IrishRail.ie", "notes": "Search with All day."}, db)
        assert saved == {"ok": True, "site": "irishrail.ie"}
        again = await bh.dispatch("browser_open", {"url": "https://www.irishrail.ie/"}, db)
        assert again["site_notes"] == "Search with All day."
        assert await bh.all_notes(db) == [{"site": "irishrail.ie", "notes": "Search with All day."}]
    finally:
        await db.close()


async def test_refusal_reaches_the_agent(link):
    link.ws = FakeSocket(link, {"ok": False, "error": "Refused: that looks like a payment button."})
    db = await _db()
    try:
        out = await bh.dispatch("browser_click", {"ref": "e4"}, db)
    finally:
        await db.close()
    assert out == {"error": "Refused: that looks like a payment button."}


async def test_asking_for_a_site_waits_for_the_user(link, monkeypatch):
    """The user has minutes to answer in a window on their laptop, not the usual 90 seconds."""
    seen = []
    real = link.call

    async def call(cmd, args=None, timeout=bh.COMMAND_TIMEOUT):
        seen.append((cmd, timeout))
        return await real(cmd, args, timeout)

    monkeypatch.setattr(link, "call", call)
    link.ws = FakeSocket(link, {"ok": True, "result": {"ok": True, "site": "ryanair.com", "allowed": "always"}})
    db = await _db()
    try:
        out = await bh.dispatch("browser_request_site", {"site": "ryanair.com", "reason": "To look up your flight"}, db)
        await bh.dispatch("browser_snapshot", {}, db)
    finally:
        await db.close()
    assert out["site"] == "ryanair.com"
    assert link.ws.sent[0] == {"id": link.ws.sent[0]["id"], "cmd": "request_site", "args": {"site": "ryanair.com", "reason": "To look up your flight"}}
    assert seen == [("request_site", bh.ASK_TIMEOUT), ("snapshot", bh.COMMAND_TIMEOUT)]
    assert bh.ASK_TIMEOUT > 120  # longer than the window waits for an answer


async def test_screenshot_goes_to_the_model_as_an_image(link):
    png = base64.b64encode(b"\x89PNG fake").decode()
    link.ws = FakeSocket(link, {"ok": True, "result": {"screenshot": png, "mime": "image/png", "url": "https://x.ie/"}})
    import mcp_server
    content = await mcp_server.call_tool("browser_screenshot", {})
    assert [c.type for c in content] == ["text", "image"]
    assert content[1].data == png and content[1].mimeType == "image/png"
    assert "screenshot" not in json.loads(content[0].text)


async def test_disconnect_fails_waiting_commands(link):
    sock = FakeSocket(link, None)  # never answers
    link.ws = sock
    task = asyncio.create_task(link.call("snapshot"))
    await asyncio.sleep(0.01)
    link.drop(sock)
    with pytest.raises(bh.HelperOffline):
        await task
    assert link.status()["connected"] is False


def test_socket_needs_the_key(app, monkeypatch, link):
    monkeypatch.setattr(bh, "HELPER_KEY", KEY)
    with TestClient(app) as tc:
        for headers in ({}, {"Authorization": "Bearer wrong"}):
            with pytest.raises(WebSocketDisconnect):
                with tc.websocket_connect("/api/browser/helper", headers=headers) as ws:
                    ws.receive_text()


def test_no_key_configured_means_no_helper(app, monkeypatch, link):
    monkeypatch.setattr(bh, "HELPER_KEY", "")
    with TestClient(app) as tc:
        with pytest.raises(WebSocketDisconnect):
            with tc.websocket_connect("/api/browser/helper", headers={"Authorization": "Bearer "}) as ws:
                ws.receive_text()


def test_hello_shows_in_status(app, monkeypatch, link, auth):
    monkeypatch.setattr(bh, "HELPER_KEY", KEY)
    with TestClient(app) as tc:
        assert tc.get("/api/browser/status", headers=auth).json()["connected"] is False
        with tc.websocket_connect("/api/browser/helper", headers={"Authorization": f"Bearer {KEY}"}) as ws:
            ws.send_text(json.dumps({"type": "hello", "sites": ["irishrail.ie"], "version": "0.1.0"}))
            ws.send_text(json.dumps({"type": "ping"}))
            assert json.loads(ws.receive_text()) == {"type": "pong"}
            st = tc.get("/api/browser/status", headers=auth).json()
            assert st["connected"] is True and st["sites"] == ["irishrail.ie"]
        assert tc.get("/api/browser/status", headers=auth).json()["connected"] is False
        assert tc.get("/api/browser/status").status_code in (401, 403)


async def test_notes_routes(client, auth):
    db = await _db()
    try:
        await bh.set_notes(db, "lner.co.uk", "Seat map: arrows show direction.")
    finally:
        await db.close()
    assert (await client.get("/api/browser/notes", headers=auth)).json() == [{"site": "lner.co.uk", "notes": "Seat map: arrows show direction."}]
    assert (await client.delete("/api/browser/notes/lner.co.uk", headers=auth)).json() == {"ok": True}
    assert (await client.get("/api/browser/notes", headers=auth)).json() == []
