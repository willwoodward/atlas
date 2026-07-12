"""
Minimal OAuth 2.1 server for MCP authentication.
Supports the PKCE authorization code flow that Claude Code requires.
"""
import hashlib
import os
import secrets
import time
from base64 import urlsafe_b64decode, urlsafe_b64encode
from typing import Optional
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, Form, Request
from fastapi.responses import JSONResponse, RedirectResponse

from auth import JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRE_DAYS
from jose import jwt
from datetime import datetime, timedelta, timezone

BASE_URL = os.getenv("BASE_URL", "https://willwoodward-clan-manager.duckdns.org")

# In-memory storage (single-process; fine for single-user server)
_clients: dict[str, dict] = {}
_auth_codes: dict[str, dict] = {}  # code → {client_id, redirect_uri, code_challenge, expires_at}

router = APIRouter()


def _make_mcp_jwt() -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": "atlas-mcp-client", "name": "Atlas MCP", "exp": expire},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def _verify_pkce(code_verifier: str, code_challenge: str) -> bool:
    digest = hashlib.sha256(code_verifier.encode()).digest()
    computed = urlsafe_b64encode(digest).rstrip(b"=").decode()
    return computed == code_challenge


# ── Discovery ────────────────────────────────────────────────────────────────

@router.get("/.well-known/oauth-authorization-server")
@router.get("/.well-known/oauth-authorization-server/{path:path}")
async def oauth_server_metadata(path: str = ""):
    return JSONResponse({
        "issuer": BASE_URL,
        "authorization_endpoint": f"{BASE_URL}/oauth/authorize",
        "token_endpoint": f"{BASE_URL}/oauth/token",
        "registration_endpoint": f"{BASE_URL}/oauth/register",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
    })


# ── Dynamic Client Registration ───────────────────────────────────────────────

@router.post("/oauth/register")
@router.post("/register")
async def register_client(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid_client_metadata"}, status_code=400)

    client_id = secrets.token_hex(16)
    client = {
        "client_id": client_id,
        "redirect_uris": body.get("redirect_uris", []),
        "client_name": body.get("client_name", "MCP Client"),
        "grant_types": ["authorization_code"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "client_id_issued_at": int(time.time()),
    }
    _clients[client_id] = client
    return JSONResponse(client, status_code=201)


# ── Authorization Endpoint ────────────────────────────────────────────────────

@router.get("/oauth/authorize")
async def oauth_authorize(
    request: Request,
    response_type: str = "",
    client_id: str = "",
    redirect_uri: str = "",
    code_challenge: str = "",
    code_challenge_method: str = "S256",
    state: Optional[str] = None,
    scope: Optional[str] = None,
):
    # Validate redirect_uri — only allow localhost for security
    parsed = urlparse(redirect_uri)
    if parsed.hostname not in ("localhost", "127.0.0.1"):
        return JSONResponse({"error": "invalid_request", "error_description": "Only localhost redirect URIs are allowed"}, status_code=400)

    if response_type != "code":
        return JSONResponse({"error": "unsupported_response_type"}, status_code=400)

    # Generate single-use authorization code
    code = secrets.token_hex(32)
    _auth_codes[code] = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_challenge": code_challenge,
        "code_challenge_method": code_challenge_method,
        "expires_at": time.time() + 600,  # 10 minutes
    }

    # Immediately redirect back with the code (no user interaction needed)
    params: dict[str, str] = {"code": code}
    if state:
        params["state"] = state
    return RedirectResponse(f"{redirect_uri}?{urlencode(params)}", status_code=302)


# ── Token Endpoint ────────────────────────────────────────────────────────────

@router.post("/oauth/token")
async def oauth_token(
    grant_type: str = Form(...),
    code: str = Form(None),
    redirect_uri: str = Form(None),
    client_id: str = Form(None),
    code_verifier: str = Form(None),
):
    if grant_type != "authorization_code":
        return JSONResponse({"error": "unsupported_grant_type"}, status_code=400)

    code_info = _auth_codes.pop(code or "", None)
    if not code_info:
        return JSONResponse({"error": "invalid_grant", "error_description": "Invalid or expired authorization code"}, status_code=400)

    if time.time() > code_info["expires_at"]:
        return JSONResponse({"error": "invalid_grant", "error_description": "Authorization code expired"}, status_code=400)

    # Verify PKCE
    if code_verifier and code_info.get("code_challenge"):
        if not _verify_pkce(code_verifier, code_info["code_challenge"]):
            return JSONResponse({"error": "invalid_grant", "error_description": "PKCE verification failed"}, status_code=400)

    access_token = _make_mcp_jwt()
    return JSONResponse({
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": JWT_EXPIRE_DAYS * 24 * 3600,
    })
