"""
Browser workflows: the steps for doing something on a website, saved so
Atlas can run them again with different values ("Book a train" with from, to,
date, time). The agent service runs them (agent/workflows.py): plain steps
go straight to the browser helper, "decide" steps hand a bounded choice to
the model, and if a step fails Atlas takes over from that page.

Steps find things by what they are (a button called "Book Tickets"), not by
refs, which change on every page load. The user's preferences are never baked
in: "decide" and "handoff" steps read them from memory each run, so changing
a preference changes every workflow at once.
"""
import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from mcp.types import Tool

from auth import get_current_user
from database import get_db

MAX_STEPS = 60
PARAM_NAME = re.compile(r"^[a-z][a-z0-9_]{0,30}$")
# {{from}}; {{params.from}} means the same.
PLACEHOLDER = re.compile(r"\{\{\s*(?:params\.)?([a-zA-Z0-9_]+)\s*\}\}")
KEYS = {"Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Space", "Backspace"}

# What each kind of step needs (besides "do"). Every step may also have
# "optional" (skip it if its target isn't there), "expect" (text that must
# appear afterwards) and "note" (why it's there).
STEP_KINDS = {
    "open": ("url",),
    "click": ("target",),
    "type": ("target", "text"),
    "select": ("target", "option"),
    "press": ("key",),
    "expect": ("text",),
    "decide": ("goal",),
    "handoff": (),
}


def _key(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip()).lower()


def _strings(step: dict):
    """Every string in a step, for checking its {{placeholders}}."""
    for k, v in step.items():
        if isinstance(v, str):
            yield v
        elif isinstance(v, dict):
            yield from (x for x in v.values() if isinstance(x, str))


def validate(params, steps) -> tuple[list[dict], list[dict]]:
    """Clean and check a workflow. Raises ValueError with what to fix."""
    if not isinstance(params, list):
        raise ValueError("params must be a list of {name, description}")
    clean_params = []
    for p in params:
        p = {"name": p} if isinstance(p, str) else p
        if not isinstance(p, dict) or not PARAM_NAME.match(str(p.get("name", ""))):
            raise ValueError(f"Bad param {p!r}: names are lower_case like from_station")
        clean_params.append({"name": p["name"], "description": str(p.get("description", ""))[:200]})
    names = {p["name"] for p in clean_params}

    if not isinstance(steps, list) or not steps:
        raise ValueError("steps must be a non-empty list")
    if len(steps) > MAX_STEPS:
        raise ValueError(f"At most {MAX_STEPS} steps")
    clean = []
    for i, step in enumerate(steps, 1):
        if not isinstance(step, dict) or step.get("do") not in STEP_KINDS:
            raise ValueError(f"Step {i}: 'do' must be one of {', '.join(STEP_KINDS)}")
        for field in STEP_KINDS[step["do"]]:
            if field not in step or step[field] in ("", None):
                raise ValueError(f"Step {i} ({step['do']}) needs '{field}'")
        if "target" in step:
            t = step["target"]
            if not isinstance(t, dict) or not isinstance(t.get("name"), str) or not t["name"].strip():
                raise ValueError(f"Step {i}: target needs a name, e.g. {{\"role\": \"button\", \"name\": \"Book Tickets\"}}")
            if t.get("match") not in (None, "exact", "contains", "regex"):
                raise ValueError(f"Step {i}: target match is exact, contains or regex")
            if t.get("match") == "regex":
                try:
                    re.compile(t["name"])
                except re.error as e:
                    raise ValueError(f"Step {i}: bad regex ({e})")
        if step["do"] == "press" and step["key"] not in KEYS:
            raise ValueError(f"Step {i}: key must be one of {', '.join(sorted(KEYS))}")
        if step["do"] == "open" and not str(step["url"]).startswith("https://"):
            raise ValueError(f"Step {i}: open needs an https:// URL")
        for text in _strings(step):
            for used in PLACEHOLDER.findall(text):
                if used not in names:
                    raise ValueError(f"Step {i} uses {{{{{used}}}}} but there's no param called '{used}'")
            # Anything else in double braces would be typed in literally.
            if "{{" in PLACEHOLDER.sub("", text):
                raise ValueError(f"Step {i}: unreadable placeholder in {text[:60]!r}. Write {{{{name}}}} with a param's name.")
        keep = {k: step[k] for k in ("do", "url", "target", "text", "submit", "option", "key", "goal",
                                      "max_actions", "optional", "expect", "timeout", "note")
                if k in step and step[k] not in ("", None, 0, False)}
        clean.append(keep)
    return clean_params, clean


def _row(r) -> dict:
    return {"name": r["title"], "site": r["site"], "description": r["description"],
            "params": json.loads(r["params"]), "steps": json.loads(r["steps"]),
            "runs": r["runs"], "last_result": r["last_result"], "updated_at": r["updated_at"]}


async def get(db, name: str) -> dict | None:
    async with db.execute("SELECT * FROM browser_workflows WHERE name = ?", (_key(name),)) as c:
        r = await c.fetchone()
    return _row(r) if r else None


async def all_workflows(db) -> list[dict]:
    async with db.execute("SELECT * FROM browser_workflows ORDER BY site, title") as c:
        return [_row(r) for r in await c.fetchall()]


async def save(db, name: str, site: str, description: str, params, steps) -> dict:
    if not _key(name):
        raise ValueError("Give the workflow a name")
    if not site or not isinstance(site, str):
        raise ValueError("Which site is it for? e.g. irishrail.ie")
    params, steps = validate(params, steps)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    await db.execute(
        """INSERT INTO browser_workflows (name, title, site, description, params, steps, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET title=excluded.title, site=excluded.site, description=excluded.description,
             params=excluded.params, steps=excluded.steps, updated_at=excluded.updated_at""",
        (_key(name), name.strip()[:80], site.strip().lower(), (description or "")[:500],
         json.dumps(params), json.dumps(steps), now))
    await db.commit()
    return await get(db, name)


async def record_run(db, name: str, result: str) -> None:
    await db.execute("UPDATE browser_workflows SET runs = runs + 1, last_result = ? WHERE name = ?",
                     (result[:200], _key(name)))
    await db.commit()


async def delete(db, name: str) -> bool:
    cur = await db.execute("DELETE FROM browser_workflows WHERE name = ?", (_key(name),))
    await db.commit()
    return cur.rowcount > 0


# ── HTTP (Settings) ──────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/browser/workflows", tags=["browser"])


@router.get("")
async def list_route(user=Depends(get_current_user), db=Depends(get_db)):
    return await all_workflows(db)


@router.delete("/{name}")
async def delete_route(name: str, user=Depends(get_current_user), db=Depends(get_db)):
    return {"ok": await delete(db, name)}


# ── Tools ────────────────────────────────────────────────────────────────────

_TARGET = {"type": "object", "properties": {
    "role": {"type": "string", "description": "button, link, textbox, select, option, checkbox, radio, tab, clickable…"},
    "name": {"type": "string", "description": "Its name as the snapshot shows it; may use {{params}}"},
    "match": {"type": "string", "enum": ["exact", "contains", "regex"], "description": "Default: exact, else contains"},
    "nth": {"type": "integer", "description": "Which match, if several (0 = first)"},
}, "required": ["name"]}

_STEP = {"type": "object", "properties": {
    "do": {"type": "string", "enum": list(STEP_KINDS)},
    "url": {"type": "string"}, "target": _TARGET, "text": {"type": "string"}, "submit": {"type": "boolean"},
    "option": {"type": "string"}, "key": {"type": "string"},
    "goal": {"type": "string", "description": "decide: the choice or job to do on this page, e.g. 'Pick the fare for the train nearest {{time}}'"},
    "max_actions": {"type": "integer", "description": "decide: most browser actions it may take (default 6)"},
    "optional": {"type": "boolean", "description": "Skip this step if its target isn't on the page (a cookie banner that only sometimes appears)"},
    "expect": {"type": "string", "description": "Text that must be on the page after this step"},
    "note": {"type": "string"},
}, "required": ["do"]}

TOOLS = [
    Tool(name="list_workflows",
         description="Saved browser workflows: steps for doing a job on a website (e.g. booking an Irish Rail train), with the values each one takes. Run one with run_workflow.",
         inputSchema={"type": "object", "properties": {}, "required": []}),
    Tool(name="save_workflow",
         description=(
             "Save (or replace) a browser workflow so the job can run by itself next time. Build it from steps that worked: "
             "each browser action's result says what it acted on (`acted`: role and name) — use those as targets, not refs. "
             "Steps: open (a URL; use a deep link when the site has one), click/type/select (by target), press, expect (text "
             "that must appear), decide (a choice that needs judgement: which train fits the time, which seat fits the user's "
             "preferences — it reads memory each run), handoff (last step: hands the page over with a summary). Put anything "
             "that changes per trip in {{params}}. Never put the user's preferences or details in steps: decide/handoff read "
             "them from memory. Mark steps that only sometimes apply (cookie banners) optional."),
         inputSchema={"type": "object", "properties": {
             "name": {"type": "string", "description": "e.g. 'Book an Irish Rail train'"},
             "site": {"type": "string", "description": "As browser_open reported it, e.g. irishrail.ie"},
             "description": {"type": "string", "description": "When to use it"},
             "params": {"type": "array", "items": {"type": "object", "properties": {
                 "name": {"type": "string"}, "description": {"type": "string", "description": "Format too, e.g. 'DD/MM/YYYY'"}},
                 "required": ["name"]}},
             "steps": {"type": "array", "items": _STEP},
         }, "required": ["name", "site", "params", "steps"]}),
    Tool(name="delete_workflow", description="Delete a saved browser workflow.",
         inputSchema={"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}),
    # Used by the workflow runner in the agent service, not by the model.
    Tool(name="get_workflow", description="One saved browser workflow with its steps.",
         inputSchema={"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}),
    Tool(name="log_workflow_run", description="Record how a workflow run went (used by the workflow runner).",
         inputSchema={"type": "object", "properties": {"name": {"type": "string"}, "result": {"type": "string"}}, "required": ["name", "result"]}),
]
NAMES = {t.name for t in TOOLS}
RUNNER_ONLY = {"log_workflow_run"}


async def dispatch(name: str, args: dict, db) -> dict | list:
    if name == "list_workflows":
        return [{k: w[k] for k in ("name", "site", "description", "params", "runs", "last_result")} | {"steps": len(w["steps"])}
                for w in await all_workflows(db)]
    if name == "get_workflow":
        w = await get(db, args.get("name", ""))
        return w or {"error": f"No workflow called '{args.get('name')}'. list_workflows shows the saved ones."}
    if name == "save_workflow":
        try:
            w = await save(db, args.get("name", ""), args.get("site", ""), args.get("description", ""),
                           args.get("params", []), args.get("steps", []))
        except ValueError as e:
            return {"error": str(e)}
        return {"ok": True, "name": w["name"], "steps": len(w["steps"]), "params": [p["name"] for p in w["params"]]}
    if name == "delete_workflow":
        return {"ok": await delete(db, args.get("name", ""))}
    if name == "log_workflow_run":
        await record_run(db, args.get("name", ""), str(args.get("result", "")))
        return {"ok": True}
    return {"error": f"Unknown tool: {name}"}
