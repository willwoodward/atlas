"""
Atlas agent service — a Strands agent with MCP access to the user's dashboard.

Runs as its own container on the internal Docker network. It publishes no ports:
the only way in is the FastAPI backend's /assistant proxy, which requires the
same Google-OAuth-issued JWT as the rest of the API. This service re-checks that
JWT independently (see auth.py).
"""
import json
import logging
from typing import Literal

from fastapi import Depends, FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import get_current_user
from questions import cancel_run, deliver
from runtime import MODEL_ID, stream_reply

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Atlas Agent")


class Message(BaseModel):
    role: str
    content: str


class Background(BaseModel):
    routine: str = Field("", max_length=200)
    approval: Literal["ask", "auto"] = "ask"
    trigger: str = Field("schedule", max_length=20)


class ChatRequest(BaseModel):
    messages: list[Message] = Field(..., min_length=1, max_length=60)
    # The API's durable run id. Answers to ask_user are routed back by it, so
    # without one the agent can stream but cannot pause to ask anything.
    run_id: str | None = None
    # The session's snapshot of the assistant's memory and system prompt,
    # taken by the API when the session started.
    memory: str | None = Field(None, max_length=50_000)
    system_prompt: str | None = Field(None, max_length=50_000)
    # Assistant settings → "Safer web access" (see web_fetch.py).
    safe_web: bool = False
    # The user spoke this and the reply will be read aloud.
    spoken: bool = False
    # Said to the corner mic with no screen to look at: speech is the whole reply.
    voice_only: bool = False
    # A routine running in the background (the inbox): {routine, approval:
    # "ask"|"auto", trigger}. With "ask", changes wait for the user's approval.
    background: Background | None = None


class AnswerRequest(BaseModel):
    question_id: str
    answer: str = Field(..., max_length=4000)


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_ID}


@app.post("/chat")
async def chat(req: ChatRequest, user: dict = Depends(get_current_user)):
    """Stream the assistant's reply as SSE.

    Events: {"type":"token","text":...} | {"type":"tool","name":...}
            | {"type":"error","message":...} | {"type":"done"}
    """
    messages = [m.model_dump() for m in req.messages]
    name = user.get("name") or ""

    async def events():
        try:
            async for kind, payload in stream_reply(messages, name, run_id=req.run_id, memory=req.memory,
                                                     system_prompt=req.system_prompt, safe_web=req.safe_web,
                                                     spoken=req.spoken, voice_only=req.voice_only,
                                                     background=req.background.model_dump() if req.background else None):
                if kind == "progress":
                    # Already a full event dict (research_plan / research_done).
                    yield f"data: {json.dumps(payload)}\n\n"
                    continue
                key = {"token": "text", "tool": "name", "error": "message"}[kind]
                yield f"data: {json.dumps({'type': kind, key: payload})}\n\n"
        finally:
            # Any question still waiting can never be answered now.
            if req.run_id:
                cancel_run(req.run_id)
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/runs/{run_id}/answer")
async def answer(run_id: str, req: AnswerRequest, user: dict = Depends(get_current_user)):
    """Deliver a user's answer to an ask_user call that is blocking a run.

    The run is still open on /chat and its agent is parked on a future; this
    resolves it so the agent continues with its context intact.
    """
    delivered = deliver(run_id, req.question_id, req.answer)
    return {"delivered": delivered}
