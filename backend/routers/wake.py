"""
The wake word's speech model ("Hey Atlas", frontend/src/lib/wakeWord/).

The browser recognises the wake word itself, on the device, with Vosk: no
audio leaves it until you've said "Hey Atlas". Vosk needs a small English
model (~40 MB) as a .tar.gz; Vosk publishes it as a .zip, so the first request
fetches the official zip, repacks it and keeps it here (WAKE_MODEL_DIR). Each
browser then downloads it once and keeps it in its own storage.

The download URL carries a fixed key derived from the server's secret, so it
isn't an open 40 MB download for anyone who finds it, while staying the same
from one visit to the next (the browser's copy is keyed by its URL). The
key comes from GET /wake/model, which needs you to be signed in.
"""
import asyncio
import hashlib
import hmac
import io
import logging
import os
import tarfile
import zipfile
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from auth import get_current_user

log = logging.getLogger("atlas.wake")

router = APIRouter(prefix="/wake", tags=["wake"])

MODELS = {
    # name: where Vosk publishes it
    "vosk-model-small-en-us-0.15": "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip",
}
DEFAULT_MODEL = "vosk-model-small-en-us-0.15"
MAX_ZIP_BYTES = 200 * 1024 * 1024
_lock = asyncio.Lock()


def model_dir() -> Path:
    default = Path(os.getenv("DATABASE_PATH", "./atlas.db")).resolve().parent / "wake"
    return Path(os.getenv("WAKE_MODEL_DIR", str(default)))


def url_key() -> str:
    secret = os.getenv("JWT_SECRET", "")
    return hmac.new(secret.encode(), b"atlas-wake-model", hashlib.sha256).hexdigest()[:32]


def repack(zip_bytes: bytes, name: str) -> bytes:
    """Vosk's .zip → the .tar.gz vosk-browser reads (one top folder, which it strips)."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z, tarfile.open(fileobj=out, mode="w:gz") as tar:
        for info in z.infolist():
            path = info.filename
            # Keep the archive's shape, but never write outside its folder.
            if path.startswith("/") or ".." in Path(path).parts:
                raise ValueError(f"Unexpected path in the model archive: {path}")
            if not path.startswith(name + "/"):
                path = f"{name}/{path}"
            ti = tarfile.TarInfo(path.rstrip("/"))
            if info.is_dir():
                ti.type = tarfile.DIRTYPE
                ti.mode = 0o755
                tar.addfile(ti)
            else:
                data = z.read(info)
                ti.size = len(data)
                ti.mode = 0o644
                tar.addfile(ti, io.BytesIO(data))
    return out.getvalue()


async def ensure_model(name: str = DEFAULT_MODEL) -> Path:
    path = model_dir() / f"{name}.tar.gz"
    if path.exists():
        return path
    async with _lock:
        if path.exists():
            return path
        log.info("Fetching the wake word model %s", name)
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0), follow_redirects=True) as client:
            resp = await client.get(MODELS[name])
        if resp.status_code != 200 or len(resp.content) > MAX_ZIP_BYTES:
            raise HTTPException(502, "Couldn't fetch the wake word model. Try again later.")
        data = await asyncio.to_thread(repack, resp.content, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(path)
        return path


@router.get("/model")
async def model_url(user: dict = Depends(get_current_user)):
    """Where this browser gets the model from (relative to the API)."""
    return {"engine": "vosk", "url": f"/wake/model/{url_key()}/{DEFAULT_MODEL}.tar.gz", "size_mb": 40}


@router.get("/model/{key}/{filename}")
async def model_file(key: str, filename: str):
    if not hmac.compare_digest(key, url_key()):
        raise HTTPException(404, "Not found")
    name = filename.removesuffix(".tar.gz")
    if name not in MODELS or not filename.endswith(".tar.gz"):
        raise HTTPException(404, "Not found")
    path = await ensure_model(name)
    return FileResponse(path, media_type="application/gzip",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})
