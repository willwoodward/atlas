import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from mcp_server import mcp_app
from routers import auth_router, habits, todos, goals, finances, notes, calendar

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

app.mount("/mcp", mcp_app)


@app.get("/health")
async def health():
    return {"status": "ok"}
