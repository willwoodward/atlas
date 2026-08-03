"""
Shared fixtures.

Every test gets its own SQLite file. The API opens short-lived connections per
request rather than holding a pool, so a temp file is both realistic and fully
isolated — no shared in-memory database that leaks state between tests.

Environment is set before importing the app, because auth.py and database.py
read their configuration at import time.
"""
import asyncio
import os
import sys
import tempfile
import uuid
from pathlib import Path

import pytest

# pytest puts the test directory on sys.path, not the package root, so `main`,
# `auth` and `routers.assistant` would not be importable without this.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

TEST_SECRET = "test-secret-not-a-real-one"
TEST_EMAIL = "will@woodwardweb.com"


@pytest.fixture(scope="session", autouse=True)
def _environment():
    """Configure the app before anything imports it."""
    tmpdir = tempfile.mkdtemp(prefix="atlas-tests-")
    os.environ.update({
        "DATABASE_PATH": str(Path(tmpdir) / "test.db"),
        "JWT_SECRET": TEST_SECRET,
        "ALLOWED_EMAILS": TEST_EMAIL,
        "ATLAS_MCP_KEY": "test-mcp-key",
        "ALLOWED_ORIGINS": "http://localhost:5173",
    })
    yield


@pytest.fixture(scope="session")
def app(_environment):
    from main import app as fastapi_app
    return fastapi_app


@pytest.fixture(autouse=True)
async def _fresh_database(_environment):
    """Recreate the schema per test so runs cannot see each other's rows."""
    from database import DATABASE_PATH, init_db
    path = Path(DATABASE_PATH)
    if path.exists():
        path.unlink()
    await init_db()
    yield


@pytest.fixture
def token():
    """A JWT for the allowed user, signed the way the real login signs one."""
    from auth import create_jwt
    return create_jwt(TEST_EMAIL, "Will")


@pytest.fixture
def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def client(app):
    import httpx
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def run_id(client, auth, monkeypatch):
    """A run row in the database, without contacting the agent.

    The driver task is what talks to the agent, so it is replaced with a no-op:
    these tests are about the durable-run machinery, not the model.
    """
    import routers.assistant as assistant

    created = str(uuid.uuid4())

    async def _noop(*args, **kwargs):
        await asyncio.sleep(3600)

    monkeypatch.setattr(assistant, "_drive_run", _noop)
    resp = await client.post("/assistant/runs", json={"messages": [{"role": "user", "content": "hi"}]},
                             headers=auth)
    assert resp.status_code == 200
    yield resp.json()["run_id"]

    for task in assistant._tasks.values():
        task.cancel()
    assistant._tasks.clear()
