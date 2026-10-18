"""The Agents page's API: agents, their prompts, and skills. The logic lives in
agent_config.py; this adds the catalog (which tools each agent can have, and
the built-in prompts), which comes partly from the agent service."""
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

import agent_config as cfg
import assistant_memory as memory
import inbox
from auth import get_current_user

log = logging.getLogger("atlas.agents")

router = APIRouter(prefix="/agents", tags=["agents"])


async def _connect():
    return await inbox.connect()


def _err(exc: Exception):
    raise HTTPException(422, str(exc))


# ── Catalog ──

async def _agent_catalog(auth: str) -> dict | None:
    """From the agent service: its default model, the built-in prompts, and
    the tools it adds itself (web, research, coding…). None if it's down."""
    from routers.assistant import AGENT_URL
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{AGENT_URL}/catalog", headers={"Authorization": auth})
        if resp.status_code == 200:
            return resp.json()
    except httpx.HTTPError:
        pass
    log.info("Agent service catalog unavailable")
    return None


async def _dashboard_tools() -> list[dict]:
    import mcp_server
    tools = await mcp_server.list_tools()
    return [{"name": t.name, "description": (t.description or "").split("\n")[0][:240],
             "writes": t.name in inbox.WRITE_TOOLS, "group": "Atlas data"} for t in tools]


@router.get("/catalog")
async def catalog(request: Request, user: dict = Depends(get_current_user)):
    agent = await _agent_catalog(request.headers.get("authorization", ""))
    dashboard = await _dashboard_tools()
    agents = (agent or {}).get("agents", {})
    out = {
        "default_model": (agent or {}).get("default_model"),
        "agent_service": agent is not None,
        "reasoning": list(cfg.REASONING),
        "engines": list(cfg.ENGINES),
        "tools": {
            # Atlas: everything in the dashboard, plus its own.
            "atlas": dashboard + agents.get("atlas", {}).get("tools", []),
            "researcher": agents.get("researcher", {}).get("tools", []),
            "coder": agents.get("coder", {}).get("tools", []),
            # One of yours: the dashboard and the web, never delegation.
            "custom": dashboard + (agent or {}).get("custom_tools", []),
        },
        "defaults": {aid: {"prompt": a.get("prompt"), "reasoning": a.get("reasoning"), "note": a.get("note")}
                     for aid, a in agents.items()},
    }
    out["defaults"].setdefault("atlas", {})["prompt"] = memory.DEFAULTS["prompt"]
    return out


# ── Agents ──

class AgentIn(BaseModel):
    name: str | None = Field(None, max_length=60)
    description: str | None = Field(None, max_length=600)
    model: str | None = Field(None, max_length=80)
    reasoning: str | None = None
    engine: str | None = None
    tools: dict[str, str] | None = None
    skills: list[str] | None = None
    enabled: bool | None = None
    prompt: str | None = Field(None, max_length=memory.MAX_CHARS)


@router.get("")
async def list_agents(user: dict = Depends(get_current_user)):
    db = await _connect()
    try:
        return {"agents": await cfg.list_agents(db), "skills": await cfg.list_skills(db)}
    finally:
        await db.close()


@router.post("")
async def create_agent(body: AgentIn, user: dict = Depends(get_current_user)):
    db = await _connect()
    try:
        return await cfg.create_agent(db, body.model_dump(exclude_none=True))
    except cfg.ConfigError as exc:
        _err(exc)
    finally:
        await db.close()


# ── Skills ── (before /{agent_id}, so "skills" isn't read as an agent id)

class SkillIn(BaseModel):
    content: str = Field(..., min_length=1, max_length=memory.MAX_CHARS)


class RestoreIn(BaseModel):
    version: int = Field(..., ge=1)


@router.get("/skills/{skill_id}")
async def get_skill(skill_id: str, user: dict = Depends(get_current_user)):
    db = await _connect()
    try:
        s = await cfg.get_skill(db, skill_id)
        if not s:
            raise HTTPException(404, "No such skill")
        return {**s, "history": await memory.history(db, 30, f"skill:{skill_id}")}
    finally:
        await db.close()


@router.post("/skills")
async def create_skill(body: SkillIn, user: dict = Depends(get_current_user)):
    db = await _connect()
    try:
        return await cfg.save_skill(db, body.content)
    except cfg.ConfigError as exc:
        _err(exc)
    finally:
        await db.close()


@router.put("/skills/{skill_id}")
async def put_skill(skill_id: str, body: SkillIn, user: dict = Depends(get_current_user)):
    db = await _connect()
    try:
        if not await cfg.get_skill(db, skill_id):
            raise HTTPException(404, "No such skill")
        return await cfg.save_skill(db, body.content, skill_id)
    except cfg.ConfigError as exc:
        _err(exc)
    finally:
        await db.close()


@router.post("/skills/{skill_id}/restore")
async def restore_skill(skill_id: str, body: RestoreIn, user: dict = Depends(get_current_user)):
    db = await _connect()
    try:
        return await cfg.restore_skill(db, skill_id, body.version)
    except cfg.ConfigError as exc:
        _err(exc)
    finally:
        await db.close()


@router.delete("/skills/{skill_id}")
async def delete_skill(skill_id: str, user: dict = Depends(get_current_user)):
    db = await _connect()
    try:
        if not await cfg.delete_skill(db, skill_id):
            raise HTTPException(404, "No such skill")
        return {"ok": True}
    finally:
        await db.close()


# ── One agent ──

@router.get("/{agent_id}")
async def get_agent(agent_id: str, user: dict = Depends(get_current_user)):
    db = await _connect()
    try:
        a = await cfg.get_agent(db, agent_id)
        if not a:
            raise HTTPException(404, "No such agent")
        return {**a, "prompt_history": await memory.history(db, 30, cfg.prompt_kind(agent_id))}
    finally:
        await db.close()


@router.put("/{agent_id}")
async def put_agent(agent_id: str, body: AgentIn, user: dict = Depends(get_current_user)):
    db = await _connect()
    try:
        a = await cfg.update_agent(db, agent_id, body.model_dump(exclude_none=True))
    except cfg.ConfigError as exc:
        _err(exc)
    finally:
        await db.close()
    if not a:
        raise HTTPException(404, "No such agent")
    return a


@router.post("/{agent_id}/prompt/restore")
async def restore_prompt(agent_id: str, body: RestoreIn | None = None, user: dict = Depends(get_current_user)):
    """Bring back an earlier prompt, or (no body) the built-in one."""
    db = await _connect()
    try:
        if not await cfg.get_agent(db, agent_id, with_prompt=False):
            raise HTTPException(404, "No such agent")
        try:
            await memory.restore(db, body.version if body else 0, cfg.prompt_kind(agent_id))
        except memory.MemoryEditError as exc:
            raise HTTPException(404, str(exc))
        return await cfg.get_agent(db, agent_id)
    finally:
        await db.close()


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str, user: dict = Depends(get_current_user)):
    db = await _connect()
    try:
        if not await cfg.delete_agent(db, agent_id):
            raise HTTPException(404, "No such agent")
        return {"ok": True}
    except cfg.ConfigError as exc:
        raise HTTPException(409, str(exc))
    finally:
        await db.close()
