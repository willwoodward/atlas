"""
The Agents page: who does the work, with what model, prompt, skills and tools.

Agents
  atlas       the assistant you talk to. Its prompt is the system prompt
              (assistant_memory kind "prompt", snapshotted per session).
  researcher  the web researchers Atlas sends out (agent/research.py).
  coder       the engineer that works on a repo (agent/coding.py).
  custom      ones you make ("Finance analyst"). Atlas hands them work with
              its ask_agent tool, and they use only the tools you give them.

You can talk to any of them except the Researcher and Coder (they work on
a task they're handed): pick the agent in the chat, or for a routine.
Subagents: which agents each one can hand work to. Atlas: the Researcher,
the Coder and all of yours, unless you choose; yours: none unless you choose;
the Researcher and Coder: none (they're the ones doing the work).

Each has a model and reasoning effort (blank = the server's default), a
prompt (built-ins: blank = their built-in prompt), skills, and a policy per
tool: on, ask (Atlas checks with you first: an approve card in the chat, or a
suggestion in the inbox for a routine), or off. Built-ins start with every
tool on; a custom agent starts with only what you tick.

Skills are SKILL.md documents (frontmatter name + description, then the
instructions). An agent with a skill sees its name and description, and loads
the full text with load_skill when it needs it.

Prompts and skills are versioned in assistant_memory (kinds "agent:<id>" and
"skill:<id>"), so every edit can be undone. What a run is sent is built by
run_config() and read by the agent service (agent/agent_settings.py).
"""
import json
import re
import uuid
from datetime import datetime, timezone

import assistant_memory as memory

BUILTINS = {
    "atlas": {"name": "Atlas", "description": "The assistant you talk to. Plans, answers and changes things across Atlas, and hands work to the others."},
    "researcher": {"name": "Researcher", "description": "Sent out by Atlas, several at once, to research one question each on the web and report back with sources."},
    "coder": {"name": "Coder", "description": "Works on a GitHub repository in a sandbox and opens a draft pull request."},
}
POLICIES = ("on", "ask", "off")
REASONING = ("", "minimal", "low", "medium", "high", "xhigh", "max")
ENGINES = ("strands",)
MAX_SKILLS = 40
MAX_CUSTOM = 20


class ConfigError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def prompt_kind(agent_id: str) -> str:
    return "prompt" if agent_id == "atlas" else f"agent:{agent_id}"


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:48]


# ── Agents ───────────────────────────────────────────────────────────────────

def _row(r) -> dict:
    d = dict(r)
    d["builtin"] = bool(d["builtin"])
    d["enabled"] = bool(d["enabled"])
    d["tools"] = json.loads(d["tools"] or "{}")
    d["skills"] = json.loads(d["skills"] or "[]")
    d["subagents"] = json.loads(d["subagents"]) if d.get("subagents") else None
    return d


WORKERS = ("researcher", "coder")   # do a task they're handed; no chats, no subagents


def default_subagents(agent_id: str, agents: list[dict]) -> list[str]:
    if agent_id == "atlas":
        return ["researcher", "coder", *[a["id"] for a in agents if not a["builtin"]]]
    return []


def subagents_of(a: dict, agents: list[dict]) -> list[str]:
    """Who this agent can hand work to: its choice, else its default, minus
    itself, the switched-off and the gone."""
    if a["id"] in WORKERS:
        return []
    chosen = a["subagents"] if a.get("subagents") is not None else default_subagents(a["id"], agents)
    usable = {x["id"] for x in agents if x["enabled"] and x["id"] not in ("atlas", a["id"])}
    return [x for x in chosen if x in usable]


async def chat_agent(db, agent_id: str | None) -> str:
    """An agent you can talk to, else Atlas."""
    if not agent_id or agent_id == "atlas" or agent_id in WORKERS:
        return "atlas"
    a = await get_agent(db, agent_id, with_prompt=False)
    return agent_id if a and a["enabled"] else "atlas"


async def ensure_builtins(db) -> None:
    now = _now()
    for aid, b in BUILTINS.items():
        await db.execute(
            "INSERT OR IGNORE INTO agents (id, name, description, builtin, created_at, updated_at) VALUES (?,?,?,1,?,?)",
            (aid, b["name"], b["description"], now, now),
        )
    await db.commit()


async def list_agents(db) -> list[dict]:
    await ensure_builtins(db)
    order = "CASE id WHEN 'atlas' THEN 0 WHEN 'researcher' THEN 1 WHEN 'coder' THEN 2 ELSE 3 END"
    async with db.execute(f"SELECT * FROM agents ORDER BY {order}, created_at") as c:
        return [_row(r) for r in await c.fetchall()]


async def get_agent(db, agent_id: str, with_prompt: bool = True) -> dict | None:
    await ensure_builtins(db)
    async with db.execute("SELECT * FROM agents WHERE id=?", (agent_id,)) as c:
        r = await c.fetchone()
    if not r:
        return None
    a = _row(r)
    if with_prompt:
        cur = await memory.current(db, prompt_kind(agent_id))
        a["prompt"], a["prompt_version"] = cur["content"], cur["version"]
    return a


def _clean_tools(tools) -> dict:
    if not isinstance(tools, dict):
        raise ConfigError("tools is a map of tool name to on, ask or off.")
    out = {}
    for name, p in tools.items():
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_:-]{1,80}", name):
            raise ConfigError(f"Not a tool name: {name!r}")
        if p not in POLICIES:
            raise ConfigError(f"{name}: the policy is on, ask or off.")
        out[name] = p
    return out


async def _clean_skills(db, skills) -> list[str]:
    if not isinstance(skills, list):
        raise ConfigError("skills is a list of skill ids.")
    known = {s["id"] for s in await list_skills(db)}
    out = []
    for s in skills:
        if s not in known:
            raise ConfigError(f"No skill called {s!r}.")
        if s not in out:
            out.append(s)
    return out


async def _clean(db, fields: dict, builtin: bool) -> dict:
    out = {}
    if "name" in fields and fields["name"] is not None:
        if builtin:
            raise ConfigError("Built-in agents keep their names.")
        out["name"] = " ".join(str(fields["name"]).split())[:60]
        if not out["name"]:
            raise ConfigError("Give the agent a name.")
    if fields.get("description") is not None:
        out["description"] = str(fields["description"]).strip()[:600]
    if fields.get("model") is not None:
        m = str(fields["model"]).strip()
        if m and not re.fullmatch(r"[A-Za-z0-9._:/-]{1,80}", m):
            raise ConfigError("That doesn't look like a model id.")
        out["model"] = m
    if fields.get("reasoning") is not None:
        if fields["reasoning"] not in REASONING:
            raise ConfigError("reasoning is one of: " + ", ".join(r or "(default)" for r in REASONING))
        out["reasoning"] = fields["reasoning"]
    if fields.get("engine") is not None:
        if fields["engine"] not in ENGINES:
            raise ConfigError("The only engine for now is strands.")
        out["engine"] = fields["engine"]
    if fields.get("tools") is not None:
        out["tools"] = json.dumps(_clean_tools(fields["tools"]))
    if fields.get("skills") is not None:
        out["skills"] = json.dumps(await _clean_skills(db, fields["skills"]))
    if "subagents" in fields and fields["subagents"] is None:
        out["subagents"] = None   # back to the default
    elif "subagents" in fields:
        subs = fields["subagents"]
        if not isinstance(subs, list):
            raise ConfigError("subagents is a list of agent ids.")
        known = {a["id"] for a in await list_agents(db)}
        clean = []
        for x in subs:
            if x not in known or x == "atlas":
                raise ConfigError(f"{x!r} isn't an agent that can be handed work.")
            if x not in clean:
                clean.append(x)
        out["subagents"] = json.dumps(clean)
    if fields.get("enabled") is not None:
        if builtin and fields["enabled"] is False:
            raise ConfigError("Built-in agents can't be switched off; turn off the tool that uses them instead.")
        out["enabled"] = 1 if fields["enabled"] else 0
    return out


async def update_agent(db, agent_id: str, fields: dict, source: str = "user") -> dict | None:
    a = await get_agent(db, agent_id, with_prompt=False)
    if not a:
        return None
    if agent_id in WORKERS and fields.get("subagents"):
        raise ConfigError("The Researcher and Coder do the work themselves; they don't hand it on.")
    if agent_id in (fields.get("subagents") or []):
        raise ConfigError("An agent can't be its own subagent.")
    cols = await _clean(db, fields, a["builtin"])
    if cols:
        cols["updated_at"] = _now()
        await db.execute(f"UPDATE agents SET {', '.join(k + '=?' for k in cols)} WHERE id=?", (*cols.values(), agent_id))
        await db.commit()
    if fields.get("prompt") is not None:
        try:
            await memory.save(db, str(fields["prompt"]), source, prompt_kind(agent_id))
        except memory.MemoryEditError as exc:
            raise ConfigError(str(exc))
    return await get_agent(db, agent_id)


async def create_agent(db, fields: dict, source: str = "user") -> dict:
    async with db.execute("SELECT COUNT(*) FROM agents WHERE builtin=0") as c:
        if (await c.fetchone())[0] >= MAX_CUSTOM:
            raise ConfigError(f"Up to {MAX_CUSTOM} agents of your own.")
    name = " ".join(str(fields.get("name") or "").split())[:60]
    if not name:
        raise ConfigError("Give the agent a name.")
    base = slug(name) or "agent"
    agent_id = base
    while agent_id in BUILTINS or await get_agent(db, agent_id, with_prompt=False):
        agent_id = f"{base}-{uuid.uuid4().hex[:4]}"
    now = _now()
    await db.execute("INSERT INTO agents (id, name, builtin, created_at, updated_at) VALUES (?,?,0,?,?)", (agent_id, name, now, now))
    await db.commit()
    try:
        return await update_agent(db, agent_id, {k: v for k, v in fields.items() if k != "name"}, source)
    except ConfigError:
        await db.execute("DELETE FROM agents WHERE id=?", (agent_id,))
        await db.commit()
        raise


async def delete_agent(db, agent_id: str) -> bool:
    a = await get_agent(db, agent_id, with_prompt=False)
    if not a:
        return False
    if a["builtin"]:
        raise ConfigError("Built-in agents can't be deleted.")
    await db.execute("DELETE FROM agents WHERE id=?", (agent_id,))
    # Its routines go back to Atlas, and nobody can hand it work any more.
    await db.execute("UPDATE routines SET agent_id=NULL WHERE agent_id=?", (agent_id,))
    async with db.execute("SELECT id, subagents FROM agents WHERE subagents LIKE ?", (f'%"{agent_id}"%',)) as c:
        for r in await c.fetchall():
            await db.execute("UPDATE agents SET subagents=? WHERE id=?",
                             (json.dumps([x for x in json.loads(r["subagents"]) if x != agent_id]), r["id"]))
    await db.commit()
    return True


# ── Skills ───────────────────────────────────────────────────────────────────

FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.S)


def parse_skill(text: str) -> tuple[str, str, str]:
    """SKILL.md → (name, description, body)."""
    text = (text or "").replace("\r\n", "\n")
    m = FRONTMATTER.match(text)
    meta, body = {}, text
    if m:
        body = text[m.end():]
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip().lower()] = v.strip().strip('"').strip("'")
    return meta.get("name", "").strip(), meta.get("description", "").strip(), body.strip()


def skill_template(name: str, description: str = "", body: str = "") -> str:
    return f"---\nname: {name}\ndescription: {description}\n---\n\n{body}".rstrip() + "\n"


async def list_skills(db) -> list[dict]:
    async with db.execute("SELECT * FROM skills ORDER BY name") as c:
        return [dict(r) for r in await c.fetchall()]


async def get_skill(db, skill_id: str) -> dict | None:
    async with db.execute("SELECT * FROM skills WHERE id=?", (skill_id,)) as c:
        r = await c.fetchone()
    if not r:
        return None
    cur = await memory.current(db, f"skill:{skill_id}")
    return {**dict(r), "content": cur["content"], "version": cur["version"]}


def _check_skill(content: str) -> tuple[str, str]:
    name, description, body = parse_skill(content)
    if not name:
        raise ConfigError("A skill starts with frontmatter: ---, name: …, description: …, ---.")
    if not description:
        raise ConfigError("Add a description: it's how an agent knows when to use the skill.")
    if not body:
        raise ConfigError("The skill has no instructions after the frontmatter.")
    return name[:60], description[:400]


async def save_skill(db, content: str, skill_id: str | None = None, source: str = "user") -> dict:
    """Create (no id) or replace a skill's SKILL.md."""
    name, description = _check_skill(content)
    now = _now()
    if skill_id is None:
        if len(await list_skills(db)) >= MAX_SKILLS:
            raise ConfigError(f"Up to {MAX_SKILLS} skills.")
        base = slug(name) or "skill"
        skill_id = base
        while await get_skill(db, skill_id):
            skill_id = f"{base}-{uuid.uuid4().hex[:4]}"
        await db.execute("INSERT INTO skills (id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)",
                         (skill_id, name, description, now, now))
    else:
        if not await get_skill(db, skill_id):
            raise ConfigError("No such skill.")
        await db.execute("UPDATE skills SET name=?, description=?, updated_at=? WHERE id=?", (name, description, now, skill_id))
    await db.commit()
    try:
        await memory.save(db, content, source, f"skill:{skill_id}")
    except memory.MemoryEditError as exc:
        raise ConfigError(str(exc))
    return await get_skill(db, skill_id)


async def delete_skill(db, skill_id: str) -> bool:
    cur = await db.execute("DELETE FROM skills WHERE id=?", (skill_id,))
    if not cur.rowcount:
        return False
    # Agents that had it stop seeing it.
    async with db.execute("SELECT id, skills FROM agents") as c:
        rows = await c.fetchall()
    for r in rows:
        ids = json.loads(r["skills"] or "[]")
        if skill_id in ids:
            await db.execute("UPDATE agents SET skills=? WHERE id=?", (json.dumps([s for s in ids if s != skill_id]), r["id"]))
    await db.commit()
    return True


async def restore_skill(db, skill_id: str, version: int) -> dict:
    old = await memory.version(db, version, f"skill:{skill_id}")
    if not old:
        raise ConfigError("No such version.")
    return await save_skill(db, old["content"], skill_id, "restore")


# ── What a run is sent ───────────────────────────────────────────────────────

async def _skills_for(db, ids: list[str]) -> list[dict]:
    out = []
    for sid in ids:
        s = await get_skill(db, sid)
        if s:
            _, _, body = parse_skill(s["content"])
            out.append({"name": s["name"], "description": s["description"], "body": body})
    return out


async def run_config(db) -> dict:
    """Every agent's settings, for the agent service. Atlas's prompt isn't
    here: it travels as system_prompt, from the session's snapshot."""
    out = {"custom": []}
    agents = await list_agents(db)
    for a in agents:
        cfg = {"model": a["model"], "reasoning": a["reasoning"], "tools": a["tools"],
               "skills": await _skills_for(db, a["skills"]), "engine": a["engine"],
               "subagents": subagents_of(a, agents)}
        if a["id"] != "atlas":
            cfg["prompt"] = (await memory.current(db, prompt_kind(a["id"])))["content"]
        if a["builtin"]:
            out[a["id"]] = cfg
        elif a["enabled"]:
            out["custom"].append({"id": a["id"], "name": a["name"], "description": a["description"], **cfg})
    return out



# ── Tools for Atlas ──────────────────────────────────────────────────────────
# So it can tune itself and its team: "give the researcher a skill for…".
# Every change is logged with an undo. Changing an agent always asks first in
# a chat (the agent service holds these to "ask" whatever the policy), so
# Atlas can't widen its own permissions without you saying yes.

from mcp.types import Tool  # noqa: E402

ALWAYS_ASK = ("create_agent", "update_agent", "delete_agent")

_POLICY_SCHEMA = {"type": "object", "additionalProperties": {"type": "string", "enum": list(POLICIES)},
                  "description": "Tool name → on | ask (check with the user first) | off. Only the tools you list change."}
_AGENT_PROPS = {
    "description": {"type": "string", "description": "What it's for; Atlas reads this to decide when to hand it work"},
    "prompt": {"type": "string", "description": "Its full instructions (replaces the current prompt). Built-ins: empty = the built-in prompt"},
    "model": {"type": "string", "description": "Model id, empty = the server default"},
    "reasoning": {"type": "string", "enum": list(REASONING)},
    "tools": _POLICY_SCHEMA,
    "skills": {"type": "array", "items": {"type": "string"}, "description": "Skill ids it can load (replaces the list)"},
    "subagents": {"type": "array", "items": {"type": "string"},
                  "description": "Agent ids it can hand work to (researcher, coder, or the user's own; replaces the list)"},
}

TOOLS = [
    Tool(name="list_agents", description="List the agents on the Agents page (Atlas, Researcher, Coder and any the user made): model, reasoning, skills, tool policies.",
         inputSchema={"type": "object", "properties": {}, "required": []}),
    Tool(name="read_agent", description="One agent's full settings, including its prompt.",
         inputSchema={"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}),
    Tool(name="create_agent", description="Make a new agent that you can hand work to with ask_agent, e.g. a finance analyst. It only gets the tools you switch on.",
         inputSchema={"type": "object", "properties": {"name": {"type": "string"}, **_AGENT_PROPS}, "required": ["name", "description", "prompt"]}),
    Tool(name="update_agent", description="Change an agent's settings (id from list_agents). Only pass what changes. Atlas's own prompt is the system prompt: use edit_system_prompt for that.",
         inputSchema={"type": "object", "properties": {"id": {"type": "string"}, "name": {"type": "string"}, **_AGENT_PROPS, "enabled": {"type": "boolean"}}, "required": ["id"]}),
    Tool(name="delete_agent", description="Delete one of the user's own agents (not a built-in).",
         inputSchema={"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}),
    Tool(name="list_skills", description="List skills: SKILL.md instructions agents can load when relevant (id, name, description).",
         inputSchema={"type": "object", "properties": {}, "required": []}),
    Tool(name="read_skill", description="Read a skill's SKILL.md.",
         inputSchema={"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}),
    Tool(name="write_skill", description="Create a skill (no id) or replace one. content is a whole SKILL.md: frontmatter with name and description (when to use it), then the instructions. Give it to an agent with update_agent(skills=…).",
         inputSchema={"type": "object", "properties": {"id": {"type": "string"}, "content": {"type": "string"}}, "required": ["content"]}),
    Tool(name="delete_skill", description="Delete a skill; agents that had it stop seeing it.",
         inputSchema={"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}),
]
NAMES = {t.name for t in TOOLS}
WRITES = {"create_agent", "update_agent", "delete_agent", "write_skill", "delete_skill"}


def _brief(a: dict) -> dict:
    return {k: a.get(k) for k in ("id", "name", "description", "builtin", "enabled", "model", "reasoning", "skills", "subagents", "tools")}


def _restore_doc_sql(kind: str, content: str) -> list:
    return [["INSERT INTO assistant_memory (content, created_at, source, kind) VALUES (?,?,?,?)", [content, _now(), "restore", kind]]]


async def dispatch(name: str, args: dict, db) -> dict:
    import agent_actions as actions
    from agent_actions import snapshot, restore_rows, delete_rows
    try:
        if name == "list_agents":
            return {"agents": [_brief(a) for a in await list_agents(db)]}
        if name == "read_agent":
            a = await get_agent(db, args.get("id", ""))
            return a or {"error": "No such agent"}
        if name == "list_skills":
            return {"skills": await list_skills(db)}
        if name == "read_skill":
            s = await get_skill(db, args.get("id", ""))
            return s or {"error": "No such skill"}

        if name == "create_agent":
            a = await create_agent(db, args, "assistant")
            show = {"kind": "agent", "id": a["id"]}
            undo = await actions.record(db, name, f"Made the agent “{a['name']}”", {"sql": delete_rows("agents", "id", [a["id"]])}, show)
            return {"ok": True, "agent": _brief(a), "undo_id": undo, "show": show}
        if name in ("update_agent", "delete_agent"):
            aid = args.get("id", "")
            before = await snapshot(db, "agents", "id = ?", (aid,))
            if not before:
                return {"error": "No such agent"}
            show = {"kind": "agent", "id": aid}
            if name == "delete_agent":
                others = await snapshot(db, "agents", "subagents LIKE ?", (f'%"{aid}"%',))
                routines = await snapshot(db, "routines", "agent_id = ?", (aid,))
                await delete_agent(db, aid)
                # Undo also gives back its routines and the agents that could hand it work.
                undo = await actions.record(db, name, f"Deleted the agent “{before[0]['name']}”",
                                            {"sql": restore_rows("agents", before + others) + restore_rows("routines", routines)},
                                            {"kind": "page", "page": "agents"})
                return {"ok": True, "undo_id": undo}
            old_prompt = (await memory.current(db, prompt_kind(aid)))["content"]
            if aid == "atlas" and args.get("prompt") is not None:
                return {"error": "Atlas's prompt is the system prompt: use edit_system_prompt or write_system_prompt."}
            a = await update_agent(db, aid, {k: v for k, v in args.items() if k != "id"}, "assistant")
            sql = restore_rows("agents", before)
            if args.get("prompt") is not None and a["prompt"] != old_prompt:
                sql += _restore_doc_sql(prompt_kind(aid), old_prompt)
            changed = [k for k in ("name", "description", "prompt", "model", "reasoning", "tools", "skills", "subagents", "enabled") if k in args]
            undo = await actions.record(db, name, f"Changed {a['name']}: {', '.join(changed) or 'nothing'}", {"sql": sql}, show)
            return {"ok": True, "agent": _brief(a), "undo_id": undo, "show": show}

        if name == "write_skill":
            sid = args.get("id")
            show_skill = lambda s: {"kind": "skill", "id": s["id"]}
            if sid:
                before = await get_skill(db, sid)
                if not before:
                    return {"error": "No such skill"}
                rows = await snapshot(db, "skills", "id = ?", (sid,))
                s = await save_skill(db, args.get("content", ""), sid, "assistant")
                sql = restore_rows("skills", rows) + _restore_doc_sql(f"skill:{sid}", before["content"])
                undo = await actions.record(db, name, f"Changed the skill “{s['name']}”", {"sql": sql}, show_skill(s))
            else:
                s = await save_skill(db, args.get("content", ""), None, "assistant")
                undo = await actions.record(db, name, f"Wrote the skill “{s['name']}”", {"sql": delete_rows("skills", "id", [s["id"]])}, show_skill(s))
            return {"ok": True, "skill": {k: s[k] for k in ("id", "name", "description")}, "undo_id": undo, "show": show_skill(s)}
        if name == "delete_skill":
            sid = args.get("id", "")
            rows = await snapshot(db, "skills", "id = ?", (sid,))
            if not rows:
                return {"error": "No such skill"}
            holders = await snapshot(db, "agents", "skills LIKE ?", (f'%"{sid}"%',))
            await delete_skill(db, sid)
            undo = await actions.record(db, name, f"Deleted the skill “{rows[0]['name']}”",
                                        {"sql": restore_rows("skills", rows) + restore_rows("agents", holders)}, {"kind": "page", "page": "agents"})
            return {"ok": True, "undo_id": undo}
    except ConfigError as exc:
        return {"error": str(exc)}
    return {"error": f"Unknown tool {name}"}
