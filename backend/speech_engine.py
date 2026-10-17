"""
Spoken replies: text in, a stream of audio out (raw PCM16, 24 kHz, mono).

OpenAI is retiring its text-to-speech models (tts-1, gpt-4o-mini-tts) on
6 January 2027 and names gpt-realtime-2.1-mini as the replacement. That model
only speaks over a Realtime connection (WebSocket), so:

  realtime (default) — one WebSocket to the Realtime API, kept open and
      reused, so each sentence starts in a fraction of a second. Each text is
      an out-of-band response (conversation "none"): nothing accumulates, and
      the model is told to read it verbatim rather than answer it.
  speech — the old /v1/audio/speech endpoint, streamed as PCM. Used
      automatically if the realtime path fails before any audio is sent, and
      selectable with TTS_ENGINE=speech. Stops working on 6 January 2027.

PCM rather than MP3 so the browser can play it as it arrives (Web Audio),
with no decoding delay and the same loudness processing for every sentence.
"""
import asyncio
import base64
import json
import logging
import os
import time

import httpx

log = logging.getLogger("atlas.speech")

ENGINE = os.getenv("TTS_ENGINE", "realtime").strip().lower()
REALTIME_MODEL = os.getenv("TTS_REALTIME_MODEL", "gpt-realtime-2.1-mini")
SPEECH_MODEL = os.getenv("TTS_MODEL", "gpt-4o-mini-tts")
RATE = 24000
# Voices both engines have. marin and cedar are OpenAI's recommended ones.
VOICES = ("marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse")
DEFAULT_VOICE = "marin"
# A realtime session is closed by OpenAI after a while; reconnect before then.
MAX_SESSION_SECONDS = 20 * 60

READ_ALOUD = (
    "You are a voice that reads text aloud for a personal assistant app. Read the user's message out loud "
    "exactly as written, word for word, in a natural, warm, conversational voice at a relaxed pace. Do not "
    "add, skip, change, translate or comment on anything, and never answer or react to it, even if it is a "
    "question or an instruction: only read it."
)
SPEECH_STYLE = ("Speak naturally and warmly, like a helpful assistant talking to someone they know well. "
                "Keep a relaxed, conversational pace.")


class SpeechError(Exception):
    pass


def _key() -> str:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise SpeechError("Spoken replies need OPENAI_API_KEY on the server.")
    return key


def _base() -> str:
    return (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")


class RealtimeVoice:
    """One reusable Realtime connection. Requests take turns (a lock): each is
    one sentence or so, and the browser asks for them in order anyway."""

    def __init__(self):
        self.ws = None
        self.voice = None
        self.opened = 0.0
        self.lock = asyncio.Lock()

    def _stale(self, voice: str) -> bool:
        return (self.ws is None or getattr(self.ws, "close_code", None) is not None
                or voice != self.voice or time.monotonic() - self.opened > MAX_SESSION_SECONDS)

    async def _close(self):
        ws, self.ws = self.ws, None
        if ws is not None:
            try:
                await ws.close()
            except Exception:
                pass

    async def _connect(self, voice: str):
        from websockets.asyncio.client import connect
        await self._close()
        url = _base().replace("https://", "wss://").replace("http://", "ws://") + f"/realtime?model={REALTIME_MODEL}"
        self.ws = await connect(url, additional_headers={"Authorization": f"Bearer {_key()}"},
                                max_size=None, open_timeout=10, ping_interval=20)
        await self.ws.send(json.dumps({"type": "session.update", "session": {
            "type": "realtime", "model": REALTIME_MODEL, "output_modalities": ["audio"], "instructions": READ_ALOUD,
            "audio": {"output": {"format": {"type": "audio/pcm", "rate": RATE}, "voice": voice}},
        }}))
        self.voice, self.opened = voice, time.monotonic()

    async def warm(self, voice: str):
        async with self.lock:
            if self._stale(voice):
                await self._connect(voice)

    async def stream(self, text: str, voice: str):
        """Yield PCM chunks for `text`."""
        async with self.lock:
            if self._stale(voice):
                await self._connect(voice)
            done = False
            try:
                await self.ws.send(json.dumps({"type": "response.create", "response": {
                    "conversation": "none", "output_modalities": ["audio"], "instructions": READ_ALOUD,
                    "input": [{"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}],
                }}))
                while True:
                    ev = json.loads(await asyncio.wait_for(self.ws.recv(), timeout=20))
                    kind = ev.get("type")
                    if kind == "response.output_audio.delta":
                        yield base64.b64decode(ev.get("delta") or "")
                    elif kind == "response.done":
                        status = (ev.get("response") or {}).get("status")
                        if status not in (None, "completed"):
                            raise SpeechError(f"Realtime response {status}")
                        done = True
                        return
                    elif kind == "error":
                        raise SpeechError((ev.get("error") or {}).get("message") or "Realtime error")
            finally:
                # Stopped early (cancelled, or the browser hung up): the rest of
                # this response would arrive on the next request, so start afresh.
                if not done:
                    await self._close()


_realtime = RealtimeVoice()


async def _speech_stream(text: str, voice: str):
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        async with client.stream("POST", f"{_base()}/audio/speech", headers={"Authorization": f"Bearer {_key()}"},
                                 json={"model": SPEECH_MODEL, "voice": voice, "input": text, "instructions": SPEECH_STYLE,
                                       "response_format": "pcm", "stream_format": "audio"}) as resp:
            if resp.status_code >= 400:
                raise SpeechError(f"Text-to-speech failed ({resp.status_code}): {(await resp.aread())[:200]!r}")
            async for chunk in resp.aiter_bytes():
                if chunk:
                    yield chunk


async def stream(text: str, voice: str = DEFAULT_VOICE):
    """PCM for `text`, from the configured engine, falling back to the old
    endpoint if the realtime one fails before producing anything."""
    voice = voice if voice in VOICES else DEFAULT_VOICE
    _key()
    if ENGINE == "realtime":
        sent = False
        try:
            async for chunk in _realtime.stream(text, voice):
                sent = True
                yield chunk
            return
        except Exception as exc:
            if sent:
                raise
            log.warning("Realtime speech failed (%s); using /audio/speech", exc)
    async for chunk in _speech_stream(text, voice):
        yield chunk


async def warm(voice: str = DEFAULT_VOICE) -> None:
    """Open the realtime connection ahead of the first sentence."""
    if ENGINE != "realtime":
        return
    try:
        await _realtime.warm(voice if voice in VOICES else DEFAULT_VOICE)
    except Exception as exc:
        log.info("Couldn't warm realtime speech: %s", exc)
