import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from database import init_db
from mcp_server import mcp_app
from routers import auth_router, habits, todos, goals, finances, notes, calendar, integrations

ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:4173",
    ).split(",")
    if o.strip()
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Atlas API", lifespan=lifespan)

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
app.include_router(notes.router)
app.include_router(calendar.router)
app.include_router(integrations.router)

app.mount("/mcp", mcp_app)


@app.get("/health")
async def health():
    return {"status": "ok"}


# MCP OAuth discovery — Claude Code fetches this before connecting to any SSE MCP server.
# We don't run a full OAuth server; returning bearer_methods_supported with no
# authorization_servers tells the client to use a pre-configured bearer token directly.
BASE_URL = os.getenv("BASE_URL", "https://willwoodward-clan-manager.duckdns.org")

@app.get("/.well-known/oauth-protected-resource")
async def oauth_protected_resource():
    return JSONResponse({
        "resource": BASE_URL,
        "bearer_methods_supported": ["header"],
    })

@app.get("/.well-known/oauth-authorization-server")
async def oauth_authorization_server():
    # Return a valid OAuth error so Claude Code's Zod parser doesn't choke on a 404
    return JSONResponse({"error": "not_supported", "error_description": "This server uses static bearer tokens only"}, status_code=404)
