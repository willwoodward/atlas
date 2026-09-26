import os
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from jose import JWTError, jwt

ALLOWED_EMAILS = {e.strip().lower() for e in os.getenv("ALLOWED_EMAILS", "").split(",") if e.strip()}
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30
ATLAS_MCP_KEY = os.getenv("ATLAS_MCP_KEY", "")

# Audience separates the two kinds of token this server mints. They are signed
# with the same secret, so without an audience claim a token issued for MCP is
# indistinguishable from a token issued for a logged-in human — which is exactly
# how an MCP token used to reach every /api/* route.
AUD_APP = "atlas-app"
AUD_MCP = "atlas-mcp"

bearer = HTTPBearer(auto_error=False)


async def verify_google_token(access_token: str) -> dict:
    """Verify a Google access token and return its claims.

    The audience check matters: /userinfo happily accepts an access token minted
    for *any* Google OAuth client, so without it, a token this app never issued —
    one collected by an unrelated (or hostile) application the user signed into —
    would authenticate here.
    """
    async with httpx.AsyncClient() as client:
        if GOOGLE_CLIENT_ID:
            info = await client.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"access_token": access_token},
            )
            if info.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid Google token")
            if info.json().get("aud") != GOOGLE_CLIENT_ID:
                raise HTTPException(status_code=401, detail="Token was not issued for this application")

        resp = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google token")
    claims = resp.json()
    email = claims.get("email", "").lower()
    if not claims.get("email_verified", True):
        raise HTTPException(status_code=403, detail="Email not verified")
    if ALLOWED_EMAILS and email not in ALLOWED_EMAILS:
        raise HTTPException(status_code=403, detail="Email not authorised")
    return claims


def create_jwt(email: str, name: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": email, "name": name, "aud": AUD_APP, "exp": expire},
        JWT_SECRET, algorithm=JWT_ALGORITHM,
    )


def decode_jwt(token: str, audience: str | None = None) -> dict:
    """Verify signature and expiry. Audience is checked by the caller so the
    failure can say which kind of token was expected."""
    try:
        claims = jwt.decode(
            token, JWT_SECRET, algorithms=[JWT_ALGORITHM],
            options={"verify_aud": False},
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if audience is not None and claims.get("aud") != audience:
        raise HTTPException(status_code=401, detail="Token is not valid for this endpoint")
    return claims


async def get_current_user(credentials: HTTPAuthorizationCredentials = Security(bearer)) -> dict:
    """Two independent gates, on purpose.

    The audience claim stops a token minted for MCP from being replayed against
    the REST API, and the allow-list stops any token whose subject is not the
    owner — so a new token-minting path added later cannot silently inherit
    full access the way the MCP OAuth flow once did.
    """
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    claims = decode_jwt(credentials.credentials, audience=AUD_APP)
    email = (claims.get("sub") or "").lower()
    if ALLOWED_EMAILS and email not in ALLOWED_EMAILS:
        raise HTTPException(status_code=403, detail="Not authorised")
    return claims


async def require_mcp_key(credentials: HTTPAuthorizationCredentials = Security(bearer)):
    if not credentials or credentials.credentials != ATLAS_MCP_KEY:
        raise HTTPException(status_code=401, detail="Invalid MCP key")
