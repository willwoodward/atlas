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
