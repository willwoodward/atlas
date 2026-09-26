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

## Finances

Transactions come in from bank CSV exports rather than an API. Neither Barclays
nor Wise offers a usable read-only feed for a UK personal account — Barclays
only serves FCA-registered AISPs, Wise's personal tokens are payout-oriented and
exclude balance statements outside a handful of non-EU countries, and
GoCardless/Nordigen's free AIS tier stopped accepting signups in July 2025. The
upshot is a good one: no bank credential exists anywhere in this system, so
moving money through it is not mitigated, it is impossible.

```
Barclays/Wise CSV ──> /import/preview ──> review in UI ──> /import/commit ──> ledger
                        (writes nothing)                    (INSERT OR IGNORE)
```

Import is two-step on purpose. Preview parses, categorises and flags duplicates
without touching the database, so a wrong file or a wrong bank profile costs a
click rather than a corrupted year of history.

**Idempotency.** Every imported row carries an `external_id`: Wise's own
transaction ID where one exists, otherwise a content hash of account, date,
amount and description. A unique partial index makes re-importing an overlapping
date range a no-op — which matters, because exporting by hand means overlapping
ranges are the normal case, not the exception. Identical same-day purchases stay
distinct via an occurrence ordinal, so two £3 coffees are two rows.

**Currency.** Wise is multi-currency, so each row stores its currency and the
GBP rate *captured at import time*. Re-valuing history at today's rate would mean
last year's spending silently changed every time sterling moved.

**Categorisation.** `finances_import_rules` maps a description substring to a
category, first match wins. Rules are applied during preview, so their effect is
visible before anything is written.

Adding a bank is a parser in `backend/finance_import.py` plus an entry in
`PROFILES` — an Open Banking producer would emit the same `ParsedRow`s and reuse
the dedupe and rules downstream unchanged.

### Compensation

`/api/employment` models what you are contracted to earn: base salary, on-call,
bonuses, and RSU grants with explicit vesting tranches. It is kept strictly apart
from `finances_transactions`, which records what actually landed — summing the
two would count every payday twice.

Equity is held in **units, never a cash amount**. A grant is only worth something
at vest, and storing a guess as if it were money is how a dashboard starts lying
to you. Valuation needs a share price and an FX rate, both maintained by hand:
nothing here calls a market or FX API, which would buy a network dependency and a
data-leak surface for a number that only has to be roughly right. Missing inputs
are surfaced in the UI rather than defaulted to 1, because a silent default makes
euros look like pounds.

`effective_tax_rate` is a flat haircut for the net projection, not a tax
calculation — Irish PAYE/USC/PRSI is progressive and situation-dependent, and
pretending otherwise would be worse than an obviously approximate number.

### Assistant access

`get_finances_summary` returns aggregates only and is always available.
`list_transactions` is gated by `ATLAS_MCP_TRANSACTIONS` (`off` by default;
`redacted` hides merchant names; `full` exposes everything) — when off, the tool
is not advertised *and* the handler refuses, so a client holding a cached tool
list cannot reach it either.
