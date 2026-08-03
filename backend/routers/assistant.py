"""
Proxy to the Strands agent container.

The agent has full read/write access to every tool in the MCP server, so it is
kept off the public network entirely — no published ports, reachable only as
`agent:8100` inside the Docker network. This router is the single door in, and
it is behind the same get_current_user JWT dependency as the rest of the API.
"""
import json
import os

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from auth import get_current_user

AGENT_URL = os.getenv("AGENT_URL", "http://agent:8100")

router = APIRouter(prefix="/assistant", tags=["assistant"])


@router.post("/chat")
async def chat(request: Request, user: dict = Depends(get_current_user)):
    """Forward the chat request to the agent and stream its SSE response back."""
    body = await request.body()
    auth = request.headers.get("authorization", "")

    async def stream():
        # No read timeout: a tool-using turn can sit quiet for a while before
        # the first token. The connect timeout still catches a dead container.
        timeout = httpx.Timeout(10.0, read=None)
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                async with client.stream(
                    "POST",
                    f"{AGENT_URL}/chat",
                    content=body,
                    headers={"Authorization": auth, "Content-Type": "application/json"},
                ) as resp:
                    if resp.status_code != 200:
                        detail = (await resp.aread()).decode(errors="replace")[:200]
                        msg = {"type": "error", "message": f"Assistant unavailable ({resp.status_code}): {detail}"}
                        yield f"data: {json.dumps(msg)}\n\n"
                        yield 'data: {"type":"done"}\n\n'
                        return
                    async for chunk in resp.aiter_raw():
                        yield chunk
            except httpx.HTTPError:
                yield 'data: {"type":"error","message":"Could not reach the assistant service."}\n\n'
                yield 'data: {"type":"done"}\n\n'

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/health")
async def health(user: dict = Depends(get_current_user)):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{AGENT_URL}/health")
        return resp.json()
    except httpx.HTTPError:
        return {"status": "unreachable"}
