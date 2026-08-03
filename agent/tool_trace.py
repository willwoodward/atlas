"""
Observing tool calls as they complete.

The obvious approach — watching for `tool_result` in `agent.stream_async()` —
silently does nothing: `ToolResultEvent.is_callback_event` is False, and
stream_async only yields events where that is True. So tool arguments and
results never reach the caller that way.

`AfterToolCallEvent` is the supported hook, and it carries more than the stream
would have anyway: `tool_use.input` arrives already parsed, rather than as the
partial JSON string that streams in during the call.
"""
import json
from typing import Any, Callable

from strands.hooks import AfterToolCallEvent, HookProvider, HookRegistry

MAX_DETAIL_CHARS = 2000


def summarise_args(args: Any) -> str:
    """The human-meaningful part of a tool call — its query or URL."""
    if not isinstance(args, dict):
        return ""
    for key in ("query", "url", "urls", "path", "text", "title"):
        value = args.get(key)
        if isinstance(value, list):
            value = value[0] if value else None
        if isinstance(value, str) and value:
            return value[:160]
    return ""


def _result_text(result: Any) -> str:
    if not isinstance(result, dict):
        return ""
    return " ".join(
        block.get("text", "")
        for block in (result.get("content") or [])
        if isinstance(block, dict)
    ).strip()


class ToolTracer(HookProvider):
    """Reports each completed tool call through `emit`.

    Used for both the orchestrator's own tool calls and the research subagents',
    which is why the payload shape is supplied by the caller.
    """

    def __init__(self, emit: Callable[[dict], None], build: Callable[..., dict]):
        self._emit = emit
        self._build = build

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(AfterToolCallEvent, self._after_tool)

    def _after_tool(self, event: AfterToolCallEvent) -> None:
        tool_use = event.tool_use or {}
        result = event.result or {}
        args = tool_use.get("input")
        try:
            payload = self._build(
                tool_use_id=tool_use.get("toolUseId"),
                name=tool_use.get("name") or "",
                args=args if isinstance(args, dict) else {},
                status="error" if event.exception else result.get("status", "success"),
                output=(str(event.exception) if event.exception else _result_text(result))[:MAX_DETAIL_CHARS],
            )
        except Exception:  # a broken trace must never break the run
            return
        if payload:
            self._emit(payload)


def pretty_args(args: Any) -> str:
    try:
        return json.dumps(args, indent=2)[:MAX_DETAIL_CHARS]
    except (TypeError, ValueError):
        return str(args)[:MAX_DETAIL_CHARS]
