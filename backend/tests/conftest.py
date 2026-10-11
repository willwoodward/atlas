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

TEST_SECRET = "test-secret-not-a-real-one-but-long-enough"
TEST_EMAIL = "will@woodwardweb.com"


# Set at import, not in a fixture: test modules may import `auth` etc. while
# being collected, before any fixture runs, and those modules read their
# configuration at import time.
os.environ.update({
    "DATABASE_PATH": str(Path(tempfile.mkdtemp(prefix="atlas-tests-")) / "test.db"),
    "JWT_SECRET": TEST_SECRET,
    "ALLOWED_EMAILS": TEST_EMAIL,
    "GOOGLE_CLIENT_ID": "test-client.apps.googleusercontent.com",
    "ATLAS_MCP_KEY": "test-mcp-key",
    "ALLOWED_ORIGINS": "http://localhost:5173",
})


@pytest.fixture(scope="session", autouse=True)
def _environment():
    """Kept so fixtures can depend on configuration being in place."""
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
    import auth
    auth.reset_revocation_cache()
    yield


# Fixed ECB-style rates (1 EUR = rate CUR). GBP steps on 2026-04-01 so tests
# can tell "rate on the transaction's date" from "latest rate".
FAKE_RATES = {"GBP": [("2025-01-01", 0.80), ("2026-04-01", 0.90)], "USD": [("2025-01-01", 1.10)]}
FX_CALLS = []


@pytest.fixture(autouse=True)
def _offline_fx(monkeypatch):
    """No test may reach the real rates API. Serves FAKE_RATES for weekdays in
    the requested range, like the ECB (which publishes nothing at weekends)."""
    from datetime import date, timedelta
    import fx

    async def fake_fetch(start, currencies):
        FX_CALLS.append((start, tuple(currencies)))
        unknown = [c for c in currencies if c not in FAKE_RATES]
        if unknown:
            import httpx
            req = httpx.Request("GET", "https://example.invalid")
            raise httpx.HTTPStatusError("not found", request=req, response=httpx.Response(404, request=req))
        out = {}
        d, end = date.fromisoformat(start), date.today()
        while d <= end:
            if d.weekday() < 5:
                for c in currencies:
                    rate = [r for since, r in FAKE_RATES[c] if since <= d.isoformat()]
                    if rate:
                        out.setdefault(d.isoformat(), {})[c] = rate[-1]
            d += timedelta(days=1)
        return out

    monkeypatch.setattr(fx, "_fetch", fake_fetch)
    fx.reset_throttle()
    FX_CALLS.clear()
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
