"""Fail-closed configuration, signing out, and other hardening."""
import pytest
from fastapi import HTTPException
from jose import jwt

import auth as authmod
from conftest import TEST_EMAIL, TEST_SECRET


# ── Configuration ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("secret", ["", "change-me-in-production", "replace_with_64_random_chars", "short"])
def test_weak_jwt_secrets_are_reported(monkeypatch, secret):
    monkeypatch.setattr(authmod, "JWT_SECRET", secret)
    monkeypatch.setattr(authmod, "GOOGLE_CLIENT_ID", "id")
    assert any("JWT_SECRET" in p for p in authmod.config_problems())


def test_missing_allow_list_and_client_id_are_reported(monkeypatch):
    monkeypatch.setattr(authmod, "ALLOWED_EMAILS", set())
    monkeypatch.setattr(authmod, "GOOGLE_CLIENT_ID", "")
    problems = " ".join(authmod.config_problems())
    assert "ALLOWED_EMAILS" in problems and "GOOGLE_CLIENT_ID" in problems


def test_a_good_config_has_no_problems(monkeypatch):
    monkeypatch.setattr(authmod, "GOOGLE_CLIENT_ID", "id.apps.googleusercontent.com")
    assert authmod.config_problems() == []


async def test_server_refuses_to_start_with_a_problem(monkeypatch):
    import main
    monkeypatch.setattr(main, "config_problems", lambda: ["JWT_SECRET must be …"])
    monkeypatch.delenv("ATLAS_ALLOW_INSECURE_CONFIG", raising=False)
    with pytest.raises(RuntimeError, match="Refusing to start"):
        async with main.lifespan(main.app):
            pass


async def test_insecure_config_can_be_allowed_for_local_dev(monkeypatch):
    import main
    monkeypatch.setattr(main, "config_problems", lambda: ["JWT_SECRET must be …"])
    monkeypatch.setenv("ATLAS_ALLOW_INSECURE_CONFIG", "1")
    async with main.lifespan(main.app):
        pass


async def test_empty_allow_list_now_refuses_everyone(monkeypatch, client, auth):
    monkeypatch.setattr(authmod, "ALLOWED_EMAILS", set())
    assert (await client.get("/api/notes", headers=auth)).status_code == 403


async def test_google_sign_in_refuses_without_a_client_id(monkeypatch):
    monkeypatch.setattr(authmod, "GOOGLE_CLIENT_ID", "")
    with pytest.raises(HTTPException) as e:
        await authmod.verify_google_token("anything")
    assert e.value.status_code == 503


def test_tokens_are_never_signed_with_a_weak_secret(monkeypatch):
    monkeypatch.setattr(authmod, "JWT_SECRET", "change-me-in-production")
    with pytest.raises(HTTPException):
        authmod.create_jwt(TEST_EMAIL, "Will")


# ── Signing out ───────────────────────────────────────────────────────────────

async def test_sign_out_revokes_that_token_only(client):
    a = {"Authorization": f"Bearer {authmod.create_jwt(TEST_EMAIL, 'Will')}"}
    b = {"Authorization": f"Bearer {authmod.create_jwt(TEST_EMAIL, 'Will')}"}
    assert (await client.post("/auth/logout", headers=a)).status_code == 200
    assert (await client.get("/api/notes", headers=a)).status_code == 401   # this session is gone…
    assert (await client.get("/api/notes", headers=b)).status_code == 200   # …another device isn't


async def test_revocation_survives_a_restart(client):
    a = {"Authorization": f"Bearer {authmod.create_jwt(TEST_EMAIL, 'Will')}"}
    await client.post("/auth/logout", headers=a)
    authmod.reset_revocation_cache()          # as if the process restarted
    assert (await client.get("/api/notes", headers=a)).status_code == 401


async def test_sign_out_everywhere_kills_every_earlier_token(client, monkeypatch):
    old_style = jwt.encode({"sub": TEST_EMAIL, "aud": "atlas-app", "exp": 4102444800}, TEST_SECRET, algorithm="HS256")
    current = authmod.create_jwt(TEST_EMAIL, "Will")
    for t in (old_style, current):
        assert (await client.get("/api/notes", headers={"Authorization": f"Bearer {t}"})).status_code == 200
    await client.post("/auth/logout-all", headers={"Authorization": f"Bearer {current}"})
    for t in (old_style, current):
        assert (await client.get("/api/notes", headers={"Authorization": f"Bearer {t}"})).status_code == 401
    # Signing in again afterwards works (a token issued after the cut-off).
    import time
    monkeypatch.setattr(time, "time", lambda: authmod._valid_after + 5)
    fresh = authmod.create_jwt(TEST_EMAIL, "Will")
    monkeypatch.undo()
    assert jwt.get_unverified_claims(fresh)["iat"] >= authmod._valid_after


# ── Exposure ──────────────────────────────────────────────────────────────────

async def test_api_docs_are_off_by_default(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert (await client.get(path)).status_code == 404


async def test_mcp_key_in_the_url_is_refused_by_default(monkeypatch):
    import mcp_server

    class _Req:
        headers = {}
        query_params = {"key": "the-real-key"}

    monkeypatch.setattr(mcp_server, "ATLAS_MCP_KEY", "the-real-key")
    monkeypatch.setattr(mcp_server, "ALLOW_QUERY_KEY", False)
    assert await mcp_server._check_auth(_Req()) is False
    monkeypatch.setattr(mcp_server, "ALLOW_QUERY_KEY", True)
    assert await mcp_server._check_auth(_Req()) is True
