import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from auth import config_problems
from database import init_db
from mcp_server import mcp_app
from routers import auth_router, habits, todos, goals, finances, notes, calendar, integrations, assistant, employment, fitness
from routers.github_drafts import router as github_drafts_router
from routers.mcp_auth import router as mcp_auth_router
from routers import inbox as inbox_router
from routers import agents as agents_router
from routers import history as history_router
from routers import wake as wake_router
import browser_helper

ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:4173",
    ).split(",")
    if o.strip()
]

BASE_URL = os.getenv("BASE_URL", "https://willwoodward-clan-manager.duckdns.org")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Refuse to run with a security setting missing rather than run open.
    # ATLAS_ALLOW_INSECURE_CONFIG=1 skips this for local development only.
    problems = config_problems()
    if problems:
        if os.getenv("ATLAS_ALLOW_INSECURE_CONFIG", "").strip().lower() in ("1", "true", "yes"):
            for p in problems:
                logging.getLogger("atlas").warning("INSECURE CONFIG (allowed for dev): %s", p)
        else:
            raise RuntimeError("Refusing to start — fix .env.production:\n  - " + "\n  - ".join(problems))
    await init_db()
    # Chats are temporary unless kept: clear any that ended while we were down.
    import conversations
    await conversations.purge_now()
    # Routines (inbox.py). One API process, so one scheduler; off for tests
    # and for a second copy of the API pointed at the same database.
    task = None
    if os.getenv("ATLAS_SCHEDULER", "on").strip().lower() not in ("0", "off", "false", "no"):
        import inbox
        task = asyncio.create_task(inbox.scheduler())
    yield
    if task:
        task.cancel()


# The interactive API docs list every endpoint to anyone; off unless asked for.
_DOCS = os.getenv("ATLAS_API_DOCS", "").strip().lower() in ("1", "true", "on")

app = FastAPI(title="Atlas API", lifespan=lifespan,
              docs_url="/docs" if _DOCS else None, redoc_url="/redoc" if _DOCS else None,
              openapi_url="/openapi.json" if _DOCS else None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(habits.router)
app.include_router(todos.router)
app.include_router(goals.router)
app.include_router(finances.router)
app.include_router(employment.router)
app.include_router(fitness.router)
app.include_router(notes.router)
app.include_router(calendar.router)
app.include_router(integrations.router)
app.include_router(assistant.router)
app.include_router(inbox_router.router)
app.include_router(agents_router.router)
app.include_router(history_router.router)
app.include_router(wake_router.router)
app.include_router(github_drafts_router)
app.include_router(mcp_auth_router)
app.include_router(browser_helper.router)

app.mount("/mcp", mcp_app)


@app.get("/health")
async def health():
    return {"status": "ok"}


# MCP OAuth discovery — tells Claude Code where the authorization server is.
@app.get("/.well-known/oauth-protected-resource")
async def oauth_protected_resource():
    return JSONResponse({
        "resource": BASE_URL,
        "authorization_servers": [BASE_URL],
        "bearer_methods_supported": ["header"],
    })
