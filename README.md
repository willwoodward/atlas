# Atlas

Personal dashboard — habits, todos, goals, finances, notes, calendar.

React PWA frontend (GitHub Pages) + FastAPI backend (DigitalOcean) + MCP server for AI assistant access.

## Local dev

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

- Frontend: http://localhost:5173
- API: http://localhost:8000
- API docs: http://localhost:8000/docs

## Assistant

The Assistant page is backed by a [Strands](https://strandsagents.com) agent running in
its own `agent` container, which reaches the dashboard through the same MCP server that
Claude Desktop uses.

```
browser ──JWT──> api:8000 /assistant/chat ──> agent:8100 /chat ──MCP key──> api:8000 /mcp/sse
```

The agent container publishes **no ports**. It can call every MCP tool, so the only way
in is the api container's `/assistant` proxy, which is behind the same Google-OAuth JWT
as the rest of the API. The agent re-validates that JWT itself and additionally requires
the token subject to be in `ALLOWED_EMAILS` — which locks out the `atlas-mcp-client`
tokens minted by the MCP OAuth flow.

Set `OPENAI_API_KEY`, `TAVILY_API_KEY` (and optionally `AGENT_MODEL_ID`) in
`.env` / `.env.production`.

### Durable runs

A turn can take minutes, so runs outlive the request that started them.
`POST /assistant/runs` returns a `run_id` immediately and the API drives the run
in a background task, persisting every event to `agent_run_events`. Subscribers
`GET /assistant/runs/{id}/events?after=<seq>` to replay what they missed and then
follow live — so closing the app mid-run and reopening it elsewhere resumes.

### Research delegation

`delegate_research` lets the orchestrator compose a team at runtime: it passes a
list of objectives it invented, and one subagent runs per objective, in parallel,
each with web search and fetch tools. They report progress out-of-band through a
queue (merged into the model's own stream in `runtime.py`), so the UI shows what
each is chasing instead of sitting silent. The orchestrator then synthesises
their written summaries.

This is deliberately not a `GraphBuilder` graph — the shape of the work isn't
known until the question is asked.

```bash
# rebuild just the agent after a change
docker compose -f docker-compose.dev.yml up --build agent
docker compose -f docker-compose.dev.yml logs -f agent
```
