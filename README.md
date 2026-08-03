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

Set `OPENAI_API_KEY` (and optionally `AGENT_MODEL_ID`) in `.env` / `.env.production`.

```bash
# rebuild just the agent after a change
docker compose -f docker-compose.dev.yml up --build agent
docker compose -f docker-compose.dev.yml logs -f agent
```
