"""
Atlas agent service — a Strands agent with MCP access to the user's dashboard.

Runs as its own container on the internal Docker network. It publishes no ports:
the only way in is the FastAPI backend's /assistant proxy, which requires the
same Google-OAuth-issued JWT as the rest of the API. This service re-checks that
JWT independently (see auth.py).
"""
import json
import logging

from fastapi import Depends, FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import get_current_user
from runtime import MODEL_ID, stream_reply

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Atlas Agent")


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[Message] = Field(..., min_length=1, max_length=60)


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
            async for kind, payload in stream_reply(messages, name):
                if kind == "progress":
                    # Already a full event dict (research_plan / research_done).
                    yield f"data: {json.dumps(payload)}\n\n"
                    continue
                key = {"token": "text", "tool": "name", "error": "message"}[kind]
                yield f"data: {json.dumps({'type': kind, key: payload})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
