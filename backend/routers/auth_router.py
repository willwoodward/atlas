from fastapi import APIRouter, Depends
from pydantic import BaseModel
from auth import create_jwt, get_current_user, verify_google_token
from database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


class GoogleTokenIn(BaseModel):
    access_token: str


@router.post("/google")
async def google_login(body: GoogleTokenIn):
    claims = await verify_google_token(body.access_token)
    email = claims.get("email", "")
    name = claims.get("name", "")
    token = create_jwt(email, name)
    return {"token": token, "email": email, "name": name}


@router.get("/me")
async def me(user=Depends(get_current_user)):
    return user
