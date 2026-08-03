"""
Out-of-band progress reporting from subagents to the UI.

A researcher or coder can work for minutes while the orchestrator emits nothing,
so subagents report through a queue the runtime drains alongside the model
stream. The queue is held in a contextvar because Strands spawns its own asyncio
tasks for tool execution, and contextvars are copied into those tasks — so a
subagent can find the queue without it being threaded through every call.

Emitting is best effort. Progress is a nicety; losing an event must never take
down the run that produced it.
"""
import contextvars
import logging

log = logging.getLogger("atlas.agent.progress")

_progress: contextvars.ContextVar = contextvars.ContextVar("atlas_progress", default=None)


def set_progress_queue(queue) -> None:
    """Called by the runtime before a run, once the queue exists."""
    _progress.set(queue)


def emit(event: dict) -> None:
    queue = _progress.get()
    if queue is None:
        return
    try:
        queue.put_nowait(event)
    except Exception:  # full or closed — progress is best effort
        log.debug("Could not emit progress", exc_info=True)
