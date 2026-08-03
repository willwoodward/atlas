"""
Dynamic research delegation.

Strands' `Agent.as_tool()` binds a fixed roster of specialists at startup, and
`GraphBuilder` needs the shape of the work known in advance. Neither fits an
orchestrator that should decide *at runtime* how many investigators a question
needs and what each one should chase.

So delegation is itself a tool. The orchestrator calls `delegate_research` with
a list of subtasks it invented, each with its own objective; this module spins up
one fresh agent per subtask, runs them concurrently, and returns their written
summaries for the orchestrator to synthesise.

Nothing here is domain-specific. The orchestrator supplies the topics, so the
same machinery serves trip planning, market research or a technical comparison.
"""
import asyncio
import contextvars
import logging
import os
import re

from strands import Agent, tool
from strands.agent.conversation_manager import (
    ProactiveCompressionConfig,
    SlidingWindowConversationManager,
)
from strands.models.openai_responses import OpenAIResponsesModel
from strands_tools import http_request, tavily

from tool_trace import ToolTracer, summarise_args

log = logging.getLogger("atlas.agent.research")

MAX_SUBAGENTS = 6
SUBAGENT_TIMEOUT = 300    # seconds, per subagent
MAX_SUMMARY_CHARS = 4000  # per researcher, when echoing summaries to the UI

# Web pages and search results are enormous, and a researcher that fetches a
# dozen of them accumulates every one in its context. Left unbounded that
# produced single requests of 450k+ tokens — well past the model's per-minute
# limit — so the context is trimmed and oversized tool results truncated.
CONTEXT_WINDOW_MESSAGES = 24
COMPRESSION_THRESHOLD = 0.6

# Concurrent researchers share one org-wide tokens-per-minute budget, so a full
# team can exhaust it even when every individual request is legal. Exceeding it
# is not fatal — Strands classifies 429s as throttling and retries with
# exponential backoff — so this trades wall-clock time against backoff stalls
# rather than preventing failures. Lower it if runs feel like they are stalling.
MAX_CONCURRENT = int(os.getenv("RESEARCH_MAX_CONCURRENT", "5"))
_slots = asyncio.Semaphore(MAX_CONCURRENT)

# Subagents can run for minutes without the orchestrator emitting anything, so
# they report progress out-of-band. The runtime sets a queue here before the run;
# contextvars are copied into the tasks Strands spawns, so the tool can find it.
_progress: contextvars.ContextVar = contextvars.ContextVar("atlas_research_progress", default=None)


def set_progress_queue(queue) -> None:
    _progress.set(queue)


def _emit(event: dict) -> None:
    queue = _progress.get()
    if queue is not None:
        try:
            queue.put_nowait(event)
        except Exception:  # full or closed — progress is best-effort
            log.debug("Could not emit research progress", exc_info=True)

RESEARCHER_PROMPT = """You are a research specialist working as part of a team. \
You have been given one specific area to investigate. Other specialists are \
covering other areas in parallel — stay in your lane and go deep rather than broad.

Your objective:
{objective}

{context}

How to work:
- Search the web for current, specific information. Prefer primary sources.
- Keep searches lean: ask for a handful of results at a time, not dozens, and \
do not request raw page content unless a snippet genuinely will not do. Extract \
a full page only when you need detail you cannot otherwise get. Your context is \
limited and bloating it with whole web pages will end the run before you report.
- Note the facts you need as you go, so your summary does not depend on earlier \
search results still being in front of you.
- Follow up on promising results to get concrete detail (names, prices, times, \
numbers, constraints) rather than generalities.
- Verify anything that looks time-sensitive; today's date matters.
- If the evidence is thin or contradictory, say so — do not fill gaps with \
plausible invention.

Finish with a written summary, at most ~400 words:
- Lead with the findings that matter for the objective.
- Include the specific details a decision needs (costs, durations, opening \
times, requirements, trade-offs).
- Note anything you could not establish.
- Put the source URL directly next to each specific claim — a price, an opening \
time, a fee — not only in a list at the end. Your colleague has to be able to \
attribute an individual figure without guessing which link it came from.
- Then finish with a "Sources:" section listing every URL you relied on.

You are writing for a colleague who will combine your summary with several \
others. They cannot see your searches — only what you write."""


def _subagent_model() -> OpenAIResponsesModel:
    """Same model as the orchestrator; subagents differ by prompt and tools, not brains."""
    client_args = {"api_key": os.environ["OPENAI_API_KEY"]}
    if os.getenv("OPENAI_BASE_URL"):
        client_args["base_url"] = os.environ["OPENAI_BASE_URL"]
    return OpenAIResponsesModel(
        client_args=client_args,
        model_id=os.getenv("AGENT_MODEL_ID", "gpt-5.6-luna"),
        params={"max_output_tokens": int(os.getenv("SUBAGENT_MAX_TOKENS", "8192"))},
    )


def _activity_tracer(index: int) -> ToolTracer:
    """Report a researcher's tool calls live, tagged with which researcher it is."""
    return ToolTracer(
        emit=_emit,
        build=lambda *, tool_use_id, name, args, status, output: {
            "type": "research_activity",
            "index": index,
            "tool": name,
            "detail": summarise_args(args),
            "status": status,
        },
    )


SOURCE_RE = re.compile(r"https?://[^\s<>\)\]\"']+")

# Failures are nearly always context blowouts from an over-broad objective, so a
# retry is only worth attempting if it is told to work more economically.
RETRY_NOTE = """

IMPORTANT — this is a second attempt. Your first run failed by exhausting its \
context. Work far more economically this time: make fewer, better-targeted \
searches, never extract full pages, and write your summary as soon as you have \
enough to be useful. A shorter summary that arrives beats a thorough one that \
does not."""


def _extract_sources(summary: str) -> list[str]:
    """URLs the researcher cited, de-duplicated, so citations survive synthesis."""
    seen, out = set(), []
    for url in SOURCE_RE.findall(summary or ""):
        url = url.rstrip(".,;")
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out[:12]


async def _attempt(index: int, objective: str, context: str, retry: bool) -> str:
    """One pass at an objective. Raises on failure."""
    prompt = RESEARCHER_PROMPT.format(
        objective=objective,
        context=f"Shared context for the wider task:\n{context}" if context else "",
    )
    agent = Agent(
        model=_subagent_model(),
        system_prompt=prompt + (RETRY_NOTE if retry else ""),
        tools=[tavily.tavily_search, tavily.tavily_extract, http_request.http_request],
        conversation_manager=SlidingWindowConversationManager(
            # A retry gets a tighter window still — the first run proved the
            # objective generates more material than the default can hold.
            window_size=CONTEXT_WINDOW_MESSAGES // 2 if retry else CONTEXT_WINDOW_MESSAGES,
            should_truncate_results=True,
            proactive_compression=ProactiveCompressionConfig(
                compression_threshold=COMPRESSION_THRESHOLD,
            ),
        ),
        hooks=[_activity_tracer(index)],
        callback_handler=None,
        name=f"researcher-{index + 1}{'-retry' if retry else ''}",
    )
    async with _slots:
        result = await asyncio.wait_for(
            agent.invoke_async("Begin your research now, then write your summary."),
            timeout=SUBAGENT_TIMEOUT,
        )
    return str(result)


async def _run_one(index: int, objective: str, context: str) -> dict:
    """Run a researcher, retrying once — a lost researcher costs a whole area."""
    label = f"researcher-{index + 1}"
    last_error = "failed"

    for attempt in range(2):
        try:
            summary = await _attempt(index, objective, context, retry=attempt > 0)
            _emit({
                "type": "research_done", "index": index, "status": "ok",
                "summary": summary[:MAX_SUMMARY_CHARS],
            })
            return {
                "objective": objective,
                "summary": summary,
                "sources": _extract_sources(summary),
                "status": "ok",
            }
        except asyncio.TimeoutError:
            last_error = f"No summary after {SUBAGENT_TIMEOUT}s — the objective was probably too broad."
            log.warning("%s attempt %d timed out on: %s", label, attempt + 1, objective)
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"[:500]
            log.exception("%s attempt %d failed", label, attempt + 1)

        if attempt == 0:
            _emit({"type": "research_retry", "index": index, "detail": last_error})

    _emit({"type": "research_done", "index": index, "status": "failed", "detail": last_error})
    return {"objective": objective, "summary": "", "sources": [], "status": f"failed: {last_error}"}


@tool
async def delegate_research(objectives: list[str], context: str = "") -> dict:
    """Spin up a team of research subagents to investigate several areas in parallel.

    Use this for any question that needs real investigation across more than one
    area — trip planning, comparing options, market or technical research. Split
    the work into genuinely separate areas of enquiry and give each one a
    self-contained objective; they run concurrently and cannot see each other.

    Write each objective as a full instruction, not a keyword. Say what to find
    out and what detail matters. Include the constraints that apply to it — a
    researcher only knows what you tell it.

    Args:
        objectives: One instruction per subagent (max 6). Each must stand alone.
        context: Background shared by all of them — the overall goal, plus
            constraints like dates, budget, party size or preferences.

    Returns:
        Each objective with the summary that researcher wrote, for you to
        synthesise into a single answer.
    """
    if not objectives:
        return {"error": "Give at least one research objective."}

    trimmed = [o for o in objectives if o and o.strip()][:MAX_SUBAGENTS]
    log.info("Delegating to %d researchers", len(trimmed))
    # Tell the UI what the team is chasing before any of it finishes.
    _emit({"type": "research_plan", "objectives": trimmed})

    results = await asyncio.gather(
        *(_run_one(i, obj, context) for i, obj in enumerate(trimmed))
    )
    ok = sum(1 for r in results if r["status"] == "ok")
    failed = [r["objective"] for r in results if r["status"] != "ok"]

    next_step = (
        "Synthesise these summaries into one answer. Attribute concrete details "
        "to the findings rather than inventing connective detail.\n\n"
        "Carry the citations through. Each finding lists the URLs it relied on in "
        "`sources`. Whenever you state a specific researched fact — a price, an "
        "opening time, a fee, a closure — link it inline as a markdown link to the "
        "source it came from, e.g. [€30–40 per night](https://...). A figure the "
        "user cannot trace back to a source is worth much less than one they can. "
        "Do not attach a source to anything that did not come from the research."
    )
    if failed:
        # Stated as an instruction, not a footnote — the model has plenty of
        # background knowledge on these topics and will otherwise paper over
        # the gap without noticing it is doing so.
        next_step += (
            f"\n\nWARNING: {len(failed)} of {len(results)} researchers returned nothing, so you "
            "have NO researched evidence on the areas listed in `unresearched`. The user can see "
            "which ones failed. You MUST tell them these areas were not covered. Either leave "
            "those topics out, or clearly mark anything you say about them as your own general "
            "knowledge rather than research. Do not present it as a finding."
        )

    return {
        "researchers": len(results),
        "succeeded": ok,
        "unresearched": failed,
        "findings": results,
        "next_step": next_step,
    }
