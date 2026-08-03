"""
Human-in-the-loop: let a running agent stop and ask.

The hard part is direction. A run streams SSE outwards, so there is no channel
for an answer to come back on. Instead the agent keeps a registry of unanswered
questions keyed by run id; the API forwards the user's reply to POST /answer,
which resolves the future the tool is waiting on and the run carries on from
exactly where it stopped — same agent, same context, same sandbox.

That is the whole reason for the plumbing. Ending the turn and asking the user
to start a new one would be far simpler, but it would destroy the coding agent
mid-task: its context, its reasoning and its half-finished working tree all go
with it. Pausing costs a queue entry; restarting costs the work.

Waits are long by design. A question asked at 2am should still be answerable at
9am, so the ceiling is hours, not minutes. Runs that are waiting are exempt from
the API's idle-stall timeout — see routers/assistant.py.
"""
import asyncio
import contextvars
import logging
import os
import uuid

from strands import tool

from progress import emit

log = logging.getLogger("atlas.agent.questions")

# Long enough to cover a night's sleep; short enough that a forgotten run does
# not pin a sandbox and a model context forever.
ANSWER_TIMEOUT = int(os.getenv("ANSWER_TIMEOUT", "28800"))  # 8 hours

# run_id -> {question_id -> Future}. Set by the runtime for the duration of a run.
_pending: dict[str, dict[str, asyncio.Future]] = {}

_run_id: contextvars.ContextVar = contextvars.ContextVar("atlas_run_id", default=None)


def set_run_id(run_id: str | None) -> None:
    _run_id.set(run_id)


def deliver(run_id: str, question_id: str, answer: str) -> bool:
    """Resolve a waiting question. Returns False if nothing was waiting for it."""
    future = _pending.get(run_id, {}).get(question_id)
    if future is None or future.done():
        return False
    future.set_result(answer)
    return True


def cancel_run(run_id: str) -> None:
    """Fail every outstanding question for a run that is going away."""
    for future in _pending.pop(run_id, {}).values():
        if not future.done():
            future.cancel()


def pending_count(run_id: str) -> int:
    return len([f for f in _pending.get(run_id, {}).values() if not f.done()])


@tool
async def ask_user(question: str, options: list[str] | None = None) -> str:
    """Ask the user something and wait for their answer before continuing.

    Use this when you genuinely cannot proceed correctly without knowing: an
    ambiguous requirement, a choice between approaches with real consequences,
    a missing detail you would otherwise have to invent. The run pauses and
    resumes with your context intact, so nothing is lost by asking.

    Do not use it for things you can find out yourself, for permission to do
    what you were already asked to do, or to confirm work you have finished.
    A question that could have been a tool call wastes the user's attention.

    Args:
        question: What you need to know. One specific question, phrased so it
            can be answered in a sentence. Say briefly why you are stuck.
        options: Optional list of concrete choices, if the answer is a pick
            rather than free text.

    Returns:
        The user's answer as text.
    """
    run_id = _run_id.get()
    if not run_id:
        # No durable run behind this call, so nobody could ever answer. Better
        # to say so than to hang for eight hours.
        return ("No interactive session is available, so this question cannot be "
                "answered. Proceed with your best judgement and state the assumption "
                "you made in your summary.")

    question_id = uuid.uuid4().hex[:12]
    loop = asyncio.get_running_loop()
    future: asyncio.Future = loop.create_future()
    _pending.setdefault(run_id, {})[question_id] = future

    emit({
        "type": "question",
        "questionId": question_id,
        "question": question,
        "options": [o for o in (options or []) if o][:6],
    })
    log.info("Waiting on question %s for run %s", question_id, run_id)

    try:
        answer = await asyncio.wait_for(future, timeout=ANSWER_TIMEOUT)
        emit({"type": "question_answered", "questionId": question_id, "answer": answer[:500]})
        return answer
    except asyncio.TimeoutError:
        emit({"type": "question_timeout", "questionId": question_id})
        return ("The user did not answer within the time limit. Proceed with your best "
                "judgement and state clearly in your summary what you assumed.")
    except asyncio.CancelledError:
        raise
    finally:
        _pending.get(run_id, {}).pop(question_id, None)
        if not _pending.get(run_id):
            _pending.pop(run_id, None)
