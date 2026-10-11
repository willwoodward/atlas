"""The agent must accept exactly the tokens the backend issues for app sessions."""
import asyncio
import importlib
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from jose import jwt

SECRET = "test-secret-that-is-long-enough-for-real"
EMAIL = "will@woodwardweb.com"


@pytest.fixture
def agent_auth(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", SECRET)
    monkeypatch.setenv("ALLOWED_EMAILS", EMAIL)
    sys.modules.pop("auth", None)
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    try:
        yield importlib.import_module("auth")
    finally:
        sys.path.pop(0)
        sys.modules.pop("auth", None)


def _token(**claims):
    base = {"sub": EMAIL, "name": "Will", "aud": "atlas-app", "exp": datetime.now(timezone.utc) + timedelta(days=30)}
    return jwt.encode({**base, **claims}, SECRET, algorithm="HS256")


def _check(mod, token):
    return asyncio.run(mod.get_current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)))


def test_accepts_an_app_session_token_as_the_backend_issues_it(agent_auth):
    # Same claims as backend/auth.py create_jwt — this is what broke the assistant.
    assert _check(agent_auth, _token())["sub"] == EMAIL


def test_rejects_an_mcp_token(agent_auth):
    with pytest.raises(HTTPException) as e:
        _check(agent_auth, _token(aud="atlas-mcp"))
    assert e.value.status_code == 401


def test_rejects_a_token_with_no_audience(agent_auth):
    with pytest.raises(HTTPException) as e:
        _check(agent_auth, _token(aud=None))
    assert e.value.status_code == 401


def test_rejects_expired_and_wrongly_signed_tokens(agent_auth):
    expired = _token(exp=datetime.now(timezone.utc) - timedelta(minutes=1))
    forged = jwt.encode({"sub": EMAIL, "aud": "atlas-app"}, "not-the-secret", algorithm="HS256")
    for tok in (expired, forged):
        with pytest.raises(HTTPException) as e:
            _check(agent_auth, tok)
        assert e.value.status_code == 401


def test_rejects_someone_not_on_the_allow_list(agent_auth):
    with pytest.raises(HTTPException) as e:
        _check(agent_auth, _token(sub="someone@else.com"))
    assert e.value.status_code == 403


def test_matches_the_backend_audience():
    backend = (Path(__file__).resolve().parents[2] / "backend" / "auth.py").read_text()
    assert 'AUD_APP = "atlas-app"' in backend


def test_refuses_everything_with_a_placeholder_secret(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "change-me-in-production")
    monkeypatch.setenv("ALLOWED_EMAILS", EMAIL)
    sys.modules.pop("auth", None)
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    try:
        mod = importlib.import_module("auth")
        forged = jwt.encode({"sub": EMAIL, "aud": "atlas-app"}, "change-me-in-production", algorithm="HS256")
        with pytest.raises(HTTPException) as e:
            _check(mod, forged)
        assert e.value.status_code == 503
    finally:
        sys.path.pop(0)
        sys.modules.pop("auth", None)
