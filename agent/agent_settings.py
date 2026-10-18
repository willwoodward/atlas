"""
Per-agent settings from the Agents page (backend/agent_config.py).

Each run carries `agents`: for atlas, researcher, coder and the user's own
agents, a model and reasoning effort (blank = the default), a prompt
(built-ins: blank = the built-in one), skills, and a policy per tool:

  on   use it freely
  ask  check with the user first. In a chat that's an approve card
       (questions.request_approval); in a routine the dashboard turns the call
       into a suggestion in the inbox (X-Atlas-Ask on the MCP connection).
  off  the tool isn't given to the agent at all

The settings for the current run are held in a context variable, so the
researchers and the coder (started from inside a tool call) see them too.
"""
import contextvars
import json
import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from strands import Agent, tool
from strands.hooks import BeforeToolCallEvent, HookProvider, HookRegistry
from strands.models.openai_responses import OpenAIResponsesModel

from questions import request_approval

log = logging.getLogger("atlas.agent.settings")

DEFAULT_MODEL = os.getenv("AGENT_MODEL_ID", "gpt-6-luna")

# Changing an agent can widen what it may do, so Atlas always asks first,
# whatever the policy says (the dashboard treats these as writes too).
ALWAYS_ASK = frozenset({"create_agent", "update_agent", "delete_agent"})

# The web reader is a different tool depending on "Safer web access"; the
# Agents page shows (and stores a policy for) one entry for all of them.
LOGICAL = {"http_request": "web_read", "fetch_page": "web_read", "tavily_extract": "web_read", "extract_pages": "web_read"}

_settings: contextvars.ContextVar = contextvars.ContextVar("atlas_agent_settings", default=None)
_background: contextvars.ContextVar = contextvars.ContextVar("atlas_agent_background", default=False)


def set_settings(agents: dict | None, background: bool = False) -> None:
    _settings.set(agents or {})
    _background.set(background)


def settings(agent_id: str) -> dict:
    return (_settings.get() or {}).get(agent_id) or {}


def custom_agents() -> list[dict]:
    return [a for a in (_settings.get() or {}).get("custom", []) if isinstance(a, dict) and a.get("id")]


# How deep handing work on can go: you → an agent → its subagent, no further,
# so two agents can't pass a task back and forth forever.
MAX_DEPTH = 2


def subagents_for(cfg: dict, agent_id: str = "atlas") -> list[str]:
    """Who this agent can hand work to (resolved by the API). Without
    settings at all, Atlas keeps its old team: researchers, coder, and any
    agents of yours."""
    if "subagents" in cfg:
        return list(cfg.get("subagents") or [])
    if agent_id == "atlas":
        return ["researcher", "coder", *[a["id"] for a in custom_agents()]]
    return []


def custom_by_id(agent_id: str) -> dict | None:
    return next((a for a in custom_agents() if a["id"] == agent_id), None)


def in_background() -> bool:
    return bool(_background.get())


def tool_name(t) -> str:
    return getattr(t, "tool_name", None) or getattr(t, "__name__", "") or ""


def policy(cfg: dict, name: str, default: str = "on") -> str:
    p = (cfg.get("tools") or {}).get(LOGICAL.get(name, name), default)
    return p if p in ("on", "ask", "off") else default


def allowed(tools: list, cfg: dict, default: str = "on") -> list:
    """The tools minus the ones switched off."""
    return [t for t in tools if policy(cfg, tool_name(t), default) != "off"]


def ask_lists(cfg: dict, default: str = "on", names=()) -> tuple[list[str], list[str]]:
    """(ask, off) tool names, for the MCP connection's headers. With a
    default of "off" (your own agents), every tool not switched on is off."""
    tools = cfg.get("tools") or {}
    ask = sorted({t for t, p in tools.items() if p == "ask"} | ALWAYS_ASK)
    off = {t for t, p in tools.items() if p == "off"}
    if default == "off":
        off |= {n for n in names if tools.get(n) not in ("on", "ask")}
    return ask, sorted(off)


def build_model(cfg: dict, effort: str | None = None, max_tokens: int = 8192, force_effort: str | None = None) -> OpenAIResponsesModel:
    """The agent's model: its own model id and reasoning effort, else the
    defaults given. force_effort (a spoken turn wants speed) wins over both."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set on the agent container")
    client_args = {"api_key": api_key}
    if os.getenv("OPENAI_BASE_URL"):
        client_args["base_url"] = os.environ["OPENAI_BASE_URL"]
    chosen = force_effort or cfg.get("reasoning") or effort
    params = {"max_output_tokens": max_tokens}
    if chosen:
        params["reasoning"] = {"effort": chosen}
    return OpenAIResponsesModel(client_args=client_args, model_id=cfg.get("model") or DEFAULT_MODEL, params=params)


def fill(template: str, values: dict, required: tuple = ()) -> str:
    """Fill {placeholders} by plain replacement (an edited prompt may have
    braces of its own). Anything required that the edit dropped is added at
    the end, so the agent still gets its task."""
    out, missing = template, []
    for k, v in values.items():
        token = "{" + k + "}"
        if token in out:
            out = out.replace(token, str(v))
        elif k in required and v:
            missing.append((k, v))
    if missing:
        out += "\n\n" + "\n\n".join(f"{k.replace('_', ' ').capitalize()}:\n{v}" for k, v in missing)
    return out


# ── Skills ───────────────────────────────────────────────────────────────────

def skills_section(skills: list[dict]) -> str:
    if not skills:
        return ""
    lines = "\n".join(f"- {s['name']}: {s['description']}" for s in skills)
    return ("\n\nSkills: instructions written for particular jobs. When one fits what you're doing, "
            "call load_skill with its name first and follow it.\n" + lines)


def load_skill_tool(skills: list[dict]):
    by_name = {s["name"].lower(): s for s in skills}

    @tool(name="load_skill", description="Load a skill's full instructions by name (from the Skills list in your instructions).")
    def load_skill(name: str) -> str:
        """Load a skill.

        Args:
            name: The skill's name, as listed.
        """
        s = by_name.get((name or "").strip().lower())
        if not s:
            return "No skill called that. Available: " + ", ".join(x["name"] for x in skills)
        return f"# {s['name']}\n\n{s['body']}"

    return load_skill


def with_skills(prompt: str, tools: list, cfg: dict) -> tuple[str, list]:
    skills = [s for s in (cfg.get("skills") or []) if isinstance(s, dict) and s.get("name") and s.get("body")]
    if not skills:
        return prompt, tools
    return prompt + skills_section(skills), [*tools, load_skill_tool(skills)]


# ── Asking first ─────────────────────────────────────────────────────────────

class ApprovalHook(HookProvider):
    """Before a tool set to "ask" runs, ask the user. No means the call is
    cancelled and the agent hears why.

    In a background run nobody is there to ask: dashboard tools are turned
    into inbox suggestions by the dashboard itself, and anything else set to
    "ask" is refused.
    """

    def __init__(self, cfg: dict, agent: str = "Atlas", default: str = "on", dashboard: set | None = None):
        self.cfg, self.agent, self.default = cfg, agent, default
        self.dashboard = dashboard or set()

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        registry.add_callback(BeforeToolCallEvent, self._before)

    def needs_asking(self, name: str) -> bool:
        return name in ALWAYS_ASK or policy(self.cfg, name, self.default) == "ask"

    async def _before(self, event: BeforeToolCallEvent) -> None:
        use = event.tool_use or {}
        name = use.get("name") or ""
        if not self.needs_asking(name):
            return
        if in_background():
            if name not in self.dashboard:
                event.cancel_tool = (f"{name} needs the user's approval, and this is a background run with "
                                     "nobody to ask. Don't use it; mention in your summary what you would have done.")
            return
        args = use.get("input")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except ValueError:
                args = {"input": args}
        ok = await request_approval(name, args or {}, self.agent)
        if ok is None:
            event.cancel_tool = (f"{name} needs the user's approval and they didn't answer. "
                                 "Don't do it; say what you would have done.")
        elif not ok:
            event.cancel_tool = (f"The user said no to {name} with these arguments. Don't try it again "
                                 "unless they ask; check what they'd prefer instead.")


# ── The user's own agents ────────────────────────────────────────────────────

CHAT_FRAME = """You are {name}, one of the agents {user} has set up in Atlas, \
their personal dashboard. You're talking with them directly (they picked you \
in the chat). Today is {today}."""

CUSTOM_FRAME = """You are {name}, one of the agents working for {user} in Atlas, \
their personal dashboard. Another agent has handed you a \
task. Do it with your tools, then reply with the result for Atlas to pass on: \
concise, specific, and clear about anything you couldn't do. Nobody can answer \
questions mid-task, so make reasonable assumptions and say what they were. \
Today is {today}."""

MAX_RESULT_CHARS = 8000
CUSTOM_TIMEOUT = int(os.getenv("CUSTOM_AGENT_TIMEOUT", "600"))


def ask_agent_tool(user: str, mcp_factory, extra_tools, timezone: str, hooks_factory,
                   allowed_ids=None, team_factory=None, depth: int = 0):
    """The tool for handing work to the user's own agents (those in
    allowed_ids, by default all of them).

    mcp_factory(agent) opens an MCP client with that agent's policies;
    extra_tools() is the web tools; hooks_factory(agent_name) the tracers;
    team_factory(agent, depth) the agent's own subagent tools, if it has any.
    """
    agents = [a for a in custom_agents() if allowed_ids is None or a["id"] in allowed_ids]
    listing = "\n".join(f"- {a['id']}: {a['name']} — {a.get('description') or 'no description'}" for a in agents)

    @tool(name="ask_agent", description=(
        "Hand a task to one of the user's own agents (set up on the Agents page) and get its answer back. "
        "Use when a task matches one's description. It can't see this conversation: give it everything it needs.\n\n"
        f"Agents you can hand work to:\n{listing}"))
    async def ask_agent(agent: str, task: str, context: str = "") -> dict:
        """Ask one of the user's agents to do something.

        Args:
            agent: The agent's id from the list.
            task: What to do, in full.
            context: Anything else it should know.
        """
        import asyncio
        a = next((x for x in agents if x["id"] == agent or x["name"].lower() == (agent or "").lower()), None)
        if not a:
            return {"error": "No agent with that id. Agents: " + ", ".join(x["id"] for x in agents)}
        today = datetime.now(ZoneInfo(timezone)).strftime("%A %-d %B %Y")
        frame = CUSTOM_FRAME.format(name=a["name"], user=user or "the user", today=today)
        prompt = frame + ("\n\n" + a["prompt"].strip() if (a.get("prompt") or "").strip() else "")
        client, tools = None, []
        try:
            client, tools = await mcp_factory(a)
        except Exception:
            log.exception("Could not open tools for %s", a["name"])
            return {"error": "Couldn't reach Atlas data for that agent."}
        try:
            tools = allowed([*tools, *extra_tools()], a, default="off")
            # Its own subagents, one level further down (none past MAX_DEPTH).
            if team_factory:
                tools += team_factory(a, depth + 1)
            prompt, tools = with_skills(prompt, tools, a)
            sub = Agent(
                model=build_model(a, max_tokens=8192),
                system_prompt=prompt,
                tools=tools,
                hooks=[*hooks_factory(a["name"]),
                       ApprovalHook(a, a["name"], default="off", dashboard={tool_name(t) for t in tools})],
                callback_handler=None,
                name=f"agent-{a['id']}",
            )
            message = task + (f"\n\nContext:\n{context}" if context else "")
            result = await asyncio.wait_for(sub.invoke_async(message), timeout=CUSTOM_TIMEOUT)
            return {"agent": a["name"], "status": "ok", "answer": str(result)[:MAX_RESULT_CHARS]}
        except asyncio.TimeoutError:
            return {"agent": a["name"], "status": "timeout", "error": f"{a['name']} ran out of time."}
        except Exception as exc:
            log.exception("Agent %s failed", a["name"])
            return {"agent": a["name"], "status": "error", "error": str(exc)[:300] or "It hit an error."}
        finally:
            if client is not None:
                try:
                    await asyncio.to_thread(client.stop, None, None, None)
                except Exception:
                    log.warning("MCP client for %s did not shut down cleanly", a["name"], exc_info=True)

    return ask_agent
