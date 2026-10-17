"""
Sessions and memory.

A session is the conversation every device shows; the browser sends only its
new message and the server supplies the history. Memory is the assistant's
standing context, versioned so any edit can be undone. The agent is stubbed —
what is under test is what it would be sent, and what the browser is told.
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest


@pytest.fixture
def sent(monkeypatch):
    """Capture each run's body instead of contacting the agent."""
    import routers.assistant as assistant
    bodies = []

    async def fake_drive(run_id, body, auth):
        bodies.append(json.loads(body))

    monkeypatch.setattr(assistant, "_drive_run", fake_drive)
    yield bodies
    assistant._tasks.clear()


async def _finish(run_id, reply, status="done"):
    import routers.assistant as assistant
    db = await assistant._connect()
    await assistant._finish(db, run_id, status, reply=reply)
    await db.close()


async def _age_session(session_id, minutes):
    import routers.assistant as assistant
    db = await assistant._connect()
    then = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    await db.execute("UPDATE agent_sessions SET updated_at=? WHERE id=?", (then, session_id))
    await db.commit()
    await db.close()


async def _send(client, auth, text, session_id=None):
    resp = await client.post("/assistant/runs", json={"message": text, "session_id": session_id}, headers=auth)
    assert resp.status_code == 200, resp.text
    await asyncio.sleep(0)  # let the stubbed driver record the body
    return resp.json()


class TestSessions:
    async def test_a_first_message_starts_a_session(self, client, auth, sent):
        run = await _send(client, auth, "Plan my Saturday")
        assert run["new_session"] is True and run["session_id"]
        assert sent[0]["messages"] == [{"role": "user", "content": "Plan my Saturday"}]

    async def test_the_agent_is_sent_the_sessions_history(self, client, auth, sent):
        first = await _send(client, auth, "What's on today?")
        await _finish(first["run_id"], "Gym at 7.")
        second = await _send(client, auth, "Move it to 8", first["session_id"])

        assert second["session_id"] == first["session_id"] and second["new_session"] is False
        assert sent[1]["messages"] == [
            {"role": "user", "content": "What's on today?"},
            {"role": "assistant", "content": "Gym at 7."},
            {"role": "user", "content": "Move it to 8"},
        ]

    async def test_every_device_sees_the_same_current_session(self, client, auth, sent):
        run = await _send(client, auth, "Hello")
        await _finish(run["run_id"], "Hi!")

        resp = await client.get("/assistant/sessions/current", headers=auth)
        body = resp.json()
        assert body["session"]["id"] == run["session_id"]
        assert [(m["role"], m["content"]) for m in body["messages"]] == [("user", "Hello"), ("assistant", "Hi!")]
        assert body["active_run"] is None

    async def test_a_running_turn_is_reported_so_another_device_can_follow_it(self, client, auth, sent):
        run = await _send(client, auth, "Research flights")
        body = (await client.get("/assistant/sessions/current", headers=auth)).json()
        assert body["active_run"] == {"id": run["run_id"], "status": "running"}

    async def test_a_session_goes_stale_after_the_idle_window(self, client, auth, sent):
        run = await _send(client, auth, "Hello")
        await _finish(run["run_id"], "Hi!")
        await _age_session(run["session_id"], 31)

        assert (await client.get("/assistant/sessions/current", headers=auth)).json()["session"] is None
        # Replying to the stale thread starts afresh, without its history.
        nxt = await _send(client, auth, "Another thing", run["session_id"])
        assert nxt["new_session"] is True and nxt["session_id"] != run["session_id"]
        assert sent[-1]["messages"] == [{"role": "user", "content": "Another thing"}]

    async def test_a_device_that_has_not_synced_joins_the_live_session(self, client, auth, sent):
        first = await _send(client, auth, "From the phone")
        await _finish(first["run_id"], "Hi phone")
        laptop = await _send(client, auth, "From the laptop")       # no session_id yet
        assert laptop["session_id"] == first["session_id"] and laptop["new_session"] is False

    async def test_a_device_that_has_not_synced_is_told_a_reply_is_running(self, client, auth, sent):
        await _send(client, auth, "From the phone")                  # still running
        resp = await client.post("/assistant/runs", json={"message": "From the laptop"}, headers=auth)
        assert resp.status_code == 409

    async def test_a_busy_session_does_not_go_stale(self, client, auth, sent):
        """A long research run outlasting the window must not orphan its thread."""
        run = await _send(client, auth, "Long research")
        await _age_session(run["session_id"], 90)
        body = (await client.get("/assistant/sessions/current", headers=auth)).json()
        assert body["session"]["id"] == run["session_id"]

    async def test_a_second_message_while_one_is_running_is_refused(self, client, auth, sent):
        run = await _send(client, auth, "First")
        resp = await client.post("/assistant/runs", json={"message": "Second", "session_id": run["session_id"]},
                                 headers=auth)
        assert resp.status_code == 409

    async def test_new_chat_closes_the_session_but_keeps_it_in_the_log(self, client, auth, sent):
        run = await _send(client, auth, "Hello")
        await _finish(run["run_id"], "Hi!")
        resp = await client.post(f"/assistant/sessions/{run['session_id']}/close", headers=auth)
        assert resp.status_code == 200

        assert (await client.get("/assistant/sessions/current", headers=auth)).json()["session"] is None
        log = (await client.get("/assistant/sessions", headers=auth)).json()["sessions"]
        assert [(s["id"], s["closed"], s["turns"]) for s in log] == [(run["session_id"], True, 1)]
        old = (await client.get(f"/assistant/sessions/{run['session_id']}", headers=auth)).json()
        assert old["messages"][1]["content"] == "Hi!"

    async def test_a_turn_without_a_reply_still_counts_as_asked(self, client, auth, sent):
        first = await _send(client, auth, "Do the thing")
        await _finish(first["run_id"], "", status="cancelled")
        await _send(client, auth, "Never mind", first["session_id"])
        assert sent[-1]["messages"] == [
            {"role": "user", "content": "Do the thing"},
            {"role": "user", "content": "Never mind"},
        ]

    async def test_sessions_need_a_token(self, client):
        assert (await client.get("/assistant/sessions/current")).status_code == 401
        assert (await client.get("/assistant/memory")).status_code == 401


class TestMemory:
    async def test_starts_empty(self, client, auth):
        body = (await client.get("/assistant/memory", headers=auth)).json()
        assert body["content"] == "" and body["version"] is None

    async def test_a_session_keeps_the_memory_it_started_with(self, client, auth, sent):
        """Loaded once per session: an edit mid-conversation waits for the next one,
        so the system prompt stays identical across the session's turns."""
        await client.put("/assistant/memory", json={"content": "Train into town: 30 min"}, headers=auth)
        first = await _send(client, auth, "Hi")
        await _finish(first["run_id"], "Hello")
        await client.put("/assistant/memory", json={"content": "Train into town: 25 min"}, headers=auth)
        await _send(client, auth, "And?", first["session_id"])
        assert [b["memory"] for b in sent] == ["Train into town: 30 min", "Train into town: 30 min"]

        await client.post(f"/assistant/sessions/{first['session_id']}/close", headers=auth)
        await _send(client, auth, "New chat")
        assert sent[-1]["memory"] == "Train into town: 25 min"

    async def test_the_assistant_can_edit_it_and_the_user_can_undo(self, client, auth):
        import mcp_server
        await client.put("/assistant/memory", json={"content": "## Routines\nGym 7am"}, headers=auth)

        db = await mcp_server._db()
        try:
            result = await mcp_server._dispatch(
                "edit_memory", {"old_text": "## Routines\n", "new_text": "## Routines\nMorning routine: 1h\n"}, db)
        finally:
            await db.close()
        assert result["ok"] and result["previous_version"] == 1
        current = (await client.get("/assistant/memory", headers=auth)).json()
        assert current["content"] == "## Routines\nMorning routine: 1h\nGym 7am"
        assert current["source"] == "assistant"

        # Undo = restore the version before the assistant's edit.
        await client.post("/assistant/memory/restore", json={"version": result["previous_version"]}, headers=auth)
        assert (await client.get("/assistant/memory", headers=auth)).json()["content"] == "## Routines\nGym 7am"
        sources = [v["source"] for v in (await client.get("/assistant/memory/history", headers=auth)).json()["versions"]]
        assert sources == ["restore", "assistant", "user"]

    async def test_the_first_assistant_edit_can_be_undone_back_to_empty(self, client, auth):
        import mcp_server
        db = await mcp_server._db()
        try:
            result = await mcp_server._dispatch("write_memory", {"content": "Likes early nights"}, db)
        finally:
            await db.close()
        assert result["previous_version"] == 0
        await client.post("/assistant/memory/restore", json={"version": 0}, headers=auth)
        assert (await client.get("/assistant/memory", headers=auth)).json()["content"] == ""

    async def test_an_ambiguous_or_missing_edit_is_refused(self, client, auth):
        import mcp_server
        await client.put("/assistant/memory", json={"content": "a\na\n"}, headers=auth)
        db = await mcp_server._db()
        try:
            twice = await mcp_server._dispatch("edit_memory", {"old_text": "a", "new_text": "b"}, db)
            missing = await mcp_server._dispatch("edit_memory", {"old_text": "zzz", "new_text": "b"}, db)
        finally:
            await db.close()
        assert "2 times" in twice["error"]
        assert "not found" in missing["error"]

    async def test_saving_identical_text_adds_no_version(self, client, auth):
        await client.put("/assistant/memory", json={"content": "x"}, headers=auth)
        await client.put("/assistant/memory", json={"content": "x"}, headers=auth)
        versions = (await client.get("/assistant/memory/history", headers=auth)).json()["versions"]
        assert len(versions) == 1

    async def test_memory_is_capped(self, client, auth):
        import assistant_memory
        resp = await client.put("/assistant/memory", json={"content": "x" * (assistant_memory.MAX_CHARS + 1)},
                                headers=auth)
        assert resp.status_code == 422


class TestSystemPrompt:
    async def test_starts_as_the_default_and_is_sent_with_each_run(self, client, auth, sent):
        from assistant_prompt import DEFAULT_PROMPT
        body = (await client.get("/assistant/prompt", headers=auth)).json()
        assert body["content"] == DEFAULT_PROMPT and body["version"] is None
        await _send(client, auth, "Hi")
        assert sent[0]["system_prompt"] == DEFAULT_PROMPT

    async def test_an_edit_applies_from_the_next_session(self, client, auth, sent):
        first = await _send(client, auth, "Hi")
        await _finish(first["run_id"], "Hello")
        await client.put("/assistant/prompt", json={"content": "You are terse, {name}."}, headers=auth)
        more = await _send(client, auth, "More", first["session_id"])
        assert sent[-1]["system_prompt"] != "You are terse, {name}."
        await _finish(more["run_id"], "Sure")
        await _age_session(first["session_id"], 31)
        await _send(client, auth, "Later")
        assert sent[-1]["system_prompt"] == "You are terse, {name}."

    async def test_the_assistant_can_edit_it_and_it_can_be_reset(self, client, auth):
        import mcp_server
        from assistant_prompt import DEFAULT_PROMPT
        db = await mcp_server._db()
        try:
            result = await mcp_server._dispatch(
                "edit_system_prompt", {"old_text": "Style: concise and direct.", "new_text": "Style: warm but brief."}, db)
        finally:
            await db.close()
        assert result["ok"] and result["document"] == "prompt" and result["previous_version"] == 0
        assert "Style: warm but brief." in (await client.get("/assistant/prompt", headers=auth)).json()["content"]

        await client.post("/assistant/prompt/restore", json={"version": 0}, headers=auth)
        assert (await client.get("/assistant/prompt", headers=auth)).json()["content"] == DEFAULT_PROMPT

    async def test_prompt_and_memory_versions_are_separate(self, client, auth):
        await client.put("/assistant/memory", json={"content": "m"}, headers=auth)
        await client.put("/assistant/prompt", json={"content": "p"}, headers=auth)
        assert (await client.get("/assistant/memory", headers=auth)).json()["content"] == "m"
        assert [v["content"] for v in (await client.get("/assistant/prompt/history", headers=auth)).json()["versions"]] == ["p"]

    async def test_an_empty_prompt_is_refused(self, client, auth):
        resp = await client.put("/assistant/prompt", json={"content": "  "}, headers=auth)
        assert resp.status_code == 422


class TestTranscribe:
    @pytest.fixture
    def openai(self, monkeypatch):
        """Stand in for OpenAI: record what was sent, answer with fixed text."""
        import httpx
        import routers.assistant as assistant
        calls = []
        real = httpx.AsyncClient

        def handler(request: httpx.Request):
            calls.append(request)
            return httpx.Response(200, json={"text": " Move the train 30 minutes earlier. "})

        monkeypatch.setattr(assistant.httpx, "AsyncClient",
                            lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        return calls

    async def test_audio_is_transcribed(self, client, auth, openai):
        resp = await client.post("/assistant/transcribe", content=b"\x1a" * 5000,
                                 headers={**auth, "Content-Type": "audio/webm;codecs=opus"})
        assert resp.status_code == 200
        assert resp.json() == {"text": "Move the train 30 minutes earlier."}
        sent = openai[0]
        assert sent.url.path.endswith("/audio/transcriptions")
        body = sent.read()
        assert b'filename="recording.webm"' in body and b"gpt-transcribe" in body

    async def test_needs_a_token(self, client, openai):
        resp = await client.post("/assistant/transcribe", content=b"x" * 5000, headers={"Content-Type": "audio/webm"})
        assert resp.status_code == 401
        assert openai == []

    async def test_only_audio_is_accepted(self, client, auth, openai):
        resp = await client.post("/assistant/transcribe", content=b"x" * 5000,
                                 headers={**auth, "Content-Type": "text/plain"})
        assert resp.status_code == 415

    async def test_a_tap_is_not_sent(self, client, auth, openai):
        resp = await client.post("/assistant/transcribe", content=b"x" * 10, headers={**auth, "Content-Type": "audio/mp4"})
        assert resp.json() == {"text": ""} and openai == []

    async def test_long_recordings_are_refused(self, client, auth, openai):
        import routers.assistant as assistant
        resp = await client.post("/assistant/transcribe", content=b"x" * (assistant.MAX_AUDIO_BYTES + 1),
                                 headers={**auth, "Content-Type": "audio/webm"})
        assert resp.status_code == 413 and openai == []

    async def test_without_a_key_it_says_so(self, client, auth, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        resp = await client.post("/assistant/transcribe", content=b"x" * 5000, headers={**auth, "Content-Type": "audio/webm"})
        assert resp.status_code == 503


class TestSettings:
    async def test_safer_web_access_is_off_by_default_and_sent_with_each_run(self, client, auth, sent):
        assert (await client.get("/assistant/settings", headers=auth)).json() == {"safe_web": False}
        await _send(client, auth, "Hi")
        assert sent[-1]["safe_web"] is False

    async def test_turning_it_on_applies_from_the_next_message(self, client, auth, sent):
        resp = await client.put("/assistant/settings", json={"safe_web": True}, headers=auth)
        assert resp.json() == {"safe_web": True}
        await _send(client, auth, "Hi")
        assert sent[-1]["safe_web"] is True

    async def test_settings_need_a_token(self, client):
        assert (await client.get("/assistant/settings")).status_code == 401


class TestSpeak:
    @pytest.fixture
    def engine(self, monkeypatch):
        import speech_engine
        calls = []

        async def fake_stream(text, voice="marin"):
            calls.append((text, voice))
            yield b"\x01\x00" * 100
            yield b"\x02\x00" * 100
        monkeypatch.setattr(speech_engine, "stream", fake_stream)
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        return calls

    async def test_text_streams_back_as_pcm(self, client, auth, engine):
        resp = await client.post("/assistant/speak", json={"text": "You're free after three.", "voice": "cedar"}, headers=auth)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/pcm" and resp.headers["x-audio-format"] == "pcm16;rate=24000;channels=1"
        assert len(resp.content) == 400 and engine == [("You're free after three.", "cedar")]

    async def test_needs_a_token(self, client, engine):
        assert (await client.post("/assistant/speak", json={"text": "Hi"})).status_code == 401
        assert engine == []

    async def test_long_text_is_refused(self, client, auth, engine):
        resp = await client.post("/assistant/speak", json={"text": "x" * 2001}, headers=auth)
        assert resp.status_code == 422 and engine == []

    async def test_an_engine_failure_is_a_status_not_a_broken_stream(self, client, auth, monkeypatch):
        import speech_engine

        async def broken(text, voice="marin"):
            raise speech_engine.SpeechError("upstream down")
            yield b""
        monkeypatch.setattr(speech_engine, "stream", broken)
        resp = await client.post("/assistant/speak", json={"text": "Hi"}, headers=auth)
        assert resp.status_code == 502 and "upstream down" in resp.json()["detail"]


class TestSpeechEngine:
    async def test_realtime_failure_falls_back_to_the_speech_endpoint(self, monkeypatch):
        import speech_engine
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        monkeypatch.setattr(speech_engine, "ENGINE", "realtime")

        async def rt_down(text, voice):
            raise OSError("no route")
            yield b""

        async def fallback(text, voice):
            yield b"pcm"
        monkeypatch.setattr(speech_engine._realtime, "stream", rt_down)
        monkeypatch.setattr(speech_engine, "_speech_stream", fallback)
        assert [c async for c in speech_engine.stream("Hi", "nova")] == [b"pcm"]

    async def test_realtime_protocol(self, monkeypatch):
        """What goes over the socket, against a stand-in Realtime server."""
        import base64
        import speech_engine
        sent = []

        class FakeWS:
            close_code = None
            def __init__(self):
                self.events = [{"type": "response.created"},
                               {"type": "response.output_audio.delta", "delta": base64.b64encode(b"abcd").decode()},
                               {"type": "response.output_audio.delta", "delta": base64.b64encode(b"efgh").decode()},
                               {"type": "response.done", "response": {"status": "completed"}}]
            async def send(self, m): sent.append(json.loads(m))
            async def recv(self): return json.dumps(self.events.pop(0))
            async def close(self): self.close_code = 1000

        async def fake_connect(url, **kw):
            sent.append({"url": url, "auth": kw["additional_headers"]["Authorization"]})
            return FakeWS()
        import websockets.asyncio.client as wsc
        monkeypatch.setattr(wsc, "connect", fake_connect)
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        voice = speech_engine.RealtimeVoice()
        out = [c async for c in voice.stream("Read me.", "marin")]
        assert out == [b"abcd", b"efgh"]
        assert sent[0]["url"].startswith("wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini")
        session = sent[1]["session"]
        assert session["output_modalities"] == ["audio"] and session["audio"]["output"] == {"format": {"type": "audio/pcm", "rate": 24000}, "voice": "marin"}
        resp = sent[2]["response"]
        assert resp["conversation"] == "none" and resp["input"][0]["content"][0]["text"] == "Read me."
        # The connection is kept for the next sentence.
        events_before = len(sent)
        voice.ws.events = [{"type": "response.output_audio.delta", "delta": base64.b64encode(b"x").decode()},
                           {"type": "response.done", "response": {"status": "completed"}}]
        assert [c async for c in voice.stream("Again.", "marin")] == [b"x"]
        assert len(sent) == events_before + 1   # no reconnect, just the new response


class TestSpoken:
    async def test_a_spoken_message_is_flagged_to_the_agent(self, client, auth, sent):
        resp = await client.post("/assistant/runs", json={"message": "What's on today?", "spoken": True}, headers=auth)
        assert resp.status_code == 200
        await asyncio.sleep(0)
        assert sent[-1]["spoken"] is True

    async def test_typed_messages_are_not(self, client, auth, sent):
        await _send(client, auth, "Hi")
        assert sent[-1]["spoken"] is False


class TestVoiceOnly:
    async def test_the_corner_mic_flags_voice_only(self, client, auth, sent):
        resp = await client.post("/assistant/runs", json={"message": "What's on?", "voice_only": True}, headers=auth)
        assert resp.status_code == 200
        await asyncio.sleep(0)
        assert sent[-1]["voice_only"] is True and sent[-1]["spoken"] is True
