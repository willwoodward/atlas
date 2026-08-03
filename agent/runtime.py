"""
Strands agent runtime — wires a model to the Atlas MCP server and streams a reply.

The MCP session is opened per request. Strands' MCPClient runs its own background
event loop in a thread and exposes blocking start/list_tools/stop calls, so those
are pushed to a worker thread to keep the FastAPI event loop free. Actual tool
invocation during the run goes through the async path, so it does not block.
"""
import asyncio
import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from mcp.client.sse import sse_client
from strands import Agent
from strands.models.openai_responses import OpenAIResponsesModel
from strands.tools.mcp import MCPClient

log = logging.getLogger("atlas.agent")

MCP_URL = os.getenv("ATLAS_MCP_URL", "http://api:8000/mcp/sse")
MCP_KEY = os.getenv("ATLAS_MCP_KEY", "")
MODEL_ID = os.getenv("AGENT_MODEL_ID", "gpt-5.6-luna")
# Covers reasoning tokens too, so this needs more headroom than a visible-reply budget.
MAX_TOKENS = int(os.getenv("AGENT_MAX_TOKENS", "8192"))
TIMEZONE = os.getenv("TZ", "Europe/London")

SYSTEM_PROMPT = """You are Atlas, {name}'s personal assistant inside their own \
life dashboard. Today is {today}.

You have live access to their todos, habits, goals, finances, notes (including \
markdown notes in a connected GitHub repo) and calendar through your tools. \
Always use the tools to look things up rather than guessing or inventing data — \
if a tool returns nothing, say so plainly.

Style: concise and direct. Short paragraphs, bullets when listing. No preamble, \
no restating the question, no filler encouragement. When you take an action \
(adding a todo, logging a habit, saving a note), state exactly what you did in \
one line.

Note on GitHub notes: writing one saves a *draft* for the user to review and \
publish from the UI — it does not push to GitHub. Say "saved as a draft" so \
they know to publish it."""


def _model() -> OpenAIResponsesModel:
    """Build the model on the Responses API (/v1/responses).

    Not chat/completions: reasoning models reject function tools there unless
    reasoning_effort is 'none', and the whole point of this agent is tool use.
    Note the Responses API budget parameter is `max_output_tokens`, and it
    covers reasoning tokens as well as the visible reply.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set on the agent container")
    client_args = {"api_key": api_key}
    if os.getenv("OPENAI_BASE_URL"):
        client_args["base_url"] = os.environ["OPENAI_BASE_URL"]
    return OpenAIResponsesModel(
        client_args=client_args,
        model_id=MODEL_ID,
        params={"max_output_tokens": MAX_TOKENS},
    )


def _mcp_client() -> MCPClient:
    headers = {"Authorization": f"Bearer {MCP_KEY}"} if MCP_KEY else {}
    return MCPClient(lambda: sse_client(MCP_URL, headers=headers))


def _to_strands(messages: list[dict]) -> list[dict]:
    """[{role, content: str}] -> Strands message blocks."""
    return [
        {"role": m["role"], "content": [{"text": m["content"]}]}
        for m in messages
        if m.get("content")
    ]


async def stream_reply(messages: list[dict], user_name: str):
    """Yield (event_type, payload) tuples: ("token", str) | ("tool", str) | ("error", str)."""
    history = _to_strands(messages)
    if not history or history[-1]["role"] != "user":
        yield ("error", "The last message must be from the user.")
        return
    prompt, prior = history[-1]["content"], history[:-1]

    today = datetime.now(ZoneInfo(TIMEZONE)).strftime("%A %-d %B %Y")
    system_prompt = SYSTEM_PROMPT.format(name=user_name or "the user", today=today)

    client = _mcp_client()
    try:
        await asyncio.to_thread(client.start)
    except Exception:
        log.exception("Could not reach the Atlas MCP server at %s", MCP_URL)
        yield ("error", "Could not reach your Atlas data. Try again in a moment.")
        return

    try:
        tools = await asyncio.to_thread(client.list_tools_sync)
        agent = Agent(
            model=_model(),
            system_prompt=system_prompt,
            tools=tools,
            messages=prior,
            callback_handler=None,
        )

        announced: set[str] = set()
        async for event in agent.stream_async(prompt):
            if "data" in event:
                yield ("token", event["data"])
            tool = event.get("current_tool_use") or {}
            # Dedupe on toolUseId — the name streams in on every delta, but the
            # same tool may legitimately be called more than once per turn.
            key, name = tool.get("toolUseId"), tool.get("name")
            if name and key and key not in announced:
                announced.add(key)
                yield ("tool", name)
    except Exception as exc:
        log.exception("Agent run failed")
        yield ("error", str(exc) or "The assistant hit an error.")
    finally:
        try:
            await asyncio.to_thread(client.stop, None, None, None)
        except Exception:
            log.warning("MCP client did not shut down cleanly", exc_info=True)
