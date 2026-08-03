"""
Auth for the Strands agent service.

The agent container is never exposed to the internet — it only listens on the
internal Docker network and the FastAPI backend proxies to it. This module is
the second layer: it re-validates the same Atlas JWT the browser obtained via
the Google OAuth flow, using the shared JWT_SECRET, and additionally requires
that the token's subject is on the ALLOWED_EMAILS whitelist.

That last check matters: the MCP OAuth server (routers/mcp_auth.py) also mints
JWTs with this secret, but with sub="atlas-mcp-client". Those tokens can reach
MCP tools; they must not be able to drive the agent.
"""
import os

from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = "HS256"
ALLOWED_EMAILS = {e.strip().lower() for e in os.getenv("ALLOWED_EMAILS", "").split(",") if e.strip()}

bearer = HTTPBearer(auto_error=False)


async def get_current_user(credentials: HTTPAuthorizationCredentials = Security(bearer)) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        claims = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    email = (claims.get("sub") or "").lower()
    if not ALLOWED_EMAILS or email not in ALLOWED_EMAILS:
        raise HTTPException(status_code=403, detail="Not authorised to use the assistant")
    return claims
