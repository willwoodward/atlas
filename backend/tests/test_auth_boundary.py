"""
The authentication boundary.

These are regression tests for a real hole: the MCP OAuth flow minted JWTs with
the same secret and no audience claim, and `get_current_user` checked only the
signature. Three unauthenticated requests — register, authorize, token — yielded
a 30-day bearer token that read and wrote every /api/* route and the MCP server.

The property worth protecting is not "that bug is gone" but "a token this app
minted for one purpose cannot be spent on another, and no token works for anyone
but the owner".
"""
from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt

from conftest import TEST_EMAIL, TEST_SECRET


def _token(sub, aud, secret=TEST_SECRET, days=1):
    return jwt.encode(
        {"sub": sub, "aud": aud, "exp": datetime.now(timezone.utc) + timedelta(days=days)},
        secret, algorithm="HS256",
    )


PROTECTED = ["/api/finances", "/api/employment", "/api/notes", "/api/todos", "/api/goals"]


# ── The original exploit chain ────────────────────────────────────────────────

async def test_oauth_endpoints_are_disabled_by_default(client):
    """The whole flow is off unless ATLAS_MCP_OAUTH is explicitly turned on."""
    assert (await client.post("/oauth/register", json={"redirect_uris": ["http://localhost:1/cb"]})).status_code == 404
    assert (await client.get("/oauth/authorize", params={
        "response_type": "code", "client_id": "x", "redirect_uri": "http://localhost:1/cb",
        "code_challenge": "y", "code_challenge_method": "S256",
    })).status_code == 404
    assert (await client.get("/.well-known/oauth-authorization-server")).status_code == 404


async def test_authorize_refuses_without_the_mcp_key_even_when_enabled(client, monkeypatch):
    import routers.mcp_auth as mcp_auth
    monkeypatch.setattr(mcp_auth, "OAUTH_ENABLED", True)
    monkeypatch.setattr(mcp_auth, "ATLAS_MCP_KEY", "the-real-key")

    resp = await client.get("/oauth/authorize", params={
        "response_type": "code", "client_id": "x", "redirect_uri": "http://localhost:1/cb",
        "code_challenge": "y", "code_challenge_method": "S256",
    })
    assert resp.status_code == 403

    resp = await client.get("/oauth/authorize", params={
        "response_type": "code", "client_id": "x", "redirect_uri": "http://localhost:1/cb",
        "code_challenge": "y", "code_challenge_method": "S256", "key": "guessed",
    })
    assert resp.status_code == 403


# ── Audience separation ───────────────────────────────────────────────────────

@pytest.mark.parametrize("path", PROTECTED)
async def test_mcp_token_cannot_reach_the_rest_api(client, path):
    """The core of the original vulnerability."""
    resp = await client.get(path, headers={"Authorization": f"Bearer {_token('atlas-mcp-client', 'atlas-mcp')}"})
    assert resp.status_code == 401


@pytest.mark.parametrize("path", PROTECTED)
async def test_token_with_no_audience_is_rejected(client, path):
    """Tokens minted before audiences existed must not be honoured."""
    legacy = jwt.encode({"sub": TEST_EMAIL, "exp": datetime.now(timezone.utc) + timedelta(days=1)},
                        TEST_SECRET, algorithm="HS256")
    assert (await client.get(path, headers={"Authorization": f"Bearer {legacy}"})).status_code == 401


# ── Ownership ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", PROTECTED)
async def test_correctly_signed_token_for_another_email_is_rejected(client, path):
    """Signature validity is not authorisation. Only the allow-listed owner passes."""
    resp = await client.get(path, headers={"Authorization": f"Bearer {_token('attacker@evil.com', 'atlas-app')}"})
    assert resp.status_code == 403


@pytest.mark.parametrize("path", PROTECTED)
async def test_owner_token_still_works(client, auth, path):
    assert (await client.get(path, headers=auth)).status_code == 200


@pytest.mark.parametrize("path", PROTECTED)
async def test_no_token_is_rejected(client, path):
    assert (await client.get(path)).status_code == 401


async def test_token_signed_with_the_wrong_secret_is_rejected(client):
    bad = _token(TEST_EMAIL, "atlas-app", secret="not-the-secret")
    assert (await client.get("/api/finances", headers={"Authorization": f"Bearer {bad}"})).status_code == 401


async def test_expired_token_is_rejected(client):
    stale = _token(TEST_EMAIL, "atlas-app", days=-1)
    assert (await client.get("/api/finances", headers={"Authorization": f"Bearer {stale}"})).status_code == 401


# ── MCP transport ─────────────────────────────────────────────────────────────

async def test_mcp_auth_fails_closed_without_a_key(monkeypatch):
    """An unset key used to mean 'open to the internet'."""
    import mcp_server

    class _Req:
        headers = {}
        query_params = {}

    monkeypatch.setattr(mcp_server, "ATLAS_MCP_KEY", "")
    monkeypatch.setattr(mcp_server, "ALLOW_INSECURE", False)
    assert await mcp_server._check_auth(_Req()) is False

    monkeypatch.setattr(mcp_server, "ALLOW_INSECURE", True)
    assert await mcp_server._check_auth(_Req()) is True


async def test_mcp_rejects_an_app_session_token(monkeypatch, token):
    """A browser session token must not be spendable as an MCP credential."""
    import mcp_server

    class _Req:
        headers = {"authorization": f"Bearer {token}"}
        query_params = {}

    monkeypatch.setattr(mcp_server, "ATLAS_MCP_KEY", "the-real-key")
    assert await mcp_server._check_auth(_Req()) is False


async def test_mcp_accepts_its_own_key_and_audience(monkeypatch):
    import mcp_server

    monkeypatch.setattr(mcp_server, "ATLAS_MCP_KEY", "the-real-key")

    class _KeyReq:
        headers = {"authorization": "Bearer the-real-key"}
        query_params = {}

    class _JwtReq:
        headers = {"authorization": f"Bearer {_token('atlas-mcp-client', 'atlas-mcp')}"}
        query_params = {}

    assert await mcp_server._check_auth(_KeyReq()) is True
    assert await mcp_server._check_auth(_JwtReq()) is True


# ── Transaction exposure ──────────────────────────────────────────────────────

async def test_transactions_tool_is_not_advertised_by_default(monkeypatch):
    import mcp_server
    monkeypatch.setattr(mcp_server, "MCP_TRANSACTIONS", "off")
    names = {t.name for t in await mcp_server.list_tools()}
    assert "list_transactions" not in names
    assert "get_finances_summary" in names


async def test_transactions_tool_refuses_even_if_called_directly(monkeypatch):
    """A client holding a cached tool list must not get through."""
    import mcp_server
    monkeypatch.setattr(mcp_server, "MCP_TRANSACTIONS", "off")
    db = await mcp_server._db()
    try:
        result = await mcp_server._dispatch("list_transactions", {}, db)
    finally:
        await db.close()
    assert "error" in result


async def test_redacted_mode_hides_merchants(client, auth, monkeypatch):
    import mcp_server
    await client.post("/api/finances/transactions", json={
        "id": "t1", "merchant": "TESCO STORES 3421", "category": "Groceries",
        "amount": 42.19, "date": "2026-04-03", "type": "expense",
    }, headers=auth)

    monkeypatch.setattr(mcp_server, "MCP_TRANSACTIONS", "redacted")
    db = await mcp_server._db()
    try:
        rows = await mcp_server._dispatch("list_transactions", {}, db)
    finally:
        await db.close()
    assert rows[0]["merchant"] == "[redacted]"
    assert rows[0]["amount"] == 42.19   # aggregate-useful fields survive
