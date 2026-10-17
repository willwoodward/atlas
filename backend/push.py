"""
Notifications on your phone or laptop when the inbox has something new
(Web Push — works for the installed PWA, including on iOS 16.4+).

The browser subscribes with our public VAPID key and gives us an endpoint at
its push service; we sign each message with the private key. The key pair is
made on first use and kept in app_settings, so there's nothing to configure.
Subscriptions the push service says are gone (404/410) are dropped.
"""
import asyncio
import base64
import json
import logging
import os

log = logging.getLogger("atlas.push")

# Who's sending, for the push service. A URL rather than an email, so no
# personal address goes to Google or Apple.
CONTACT = os.getenv("BASE_URL", "https://willwoodward-clan-manager.duckdns.org")


async def _setting(db, key):
    async with db.execute("SELECT value FROM app_settings WHERE key=?", (key,)) as c:
        row = await c.fetchone()
    return json.loads(row[0]) if row else None


async def _keys(db) -> tuple[str, str]:
    """(private key PEM, public key as the browser wants it)."""
    pem = await _setting(db, "push.vapid_private")
    if not pem:
        from py_vapid import Vapid02
        v = Vapid02()
        v.generate_keys()
        pem = v.private_pem().decode()
        await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('push.vapid_private', ?)", (json.dumps(pem),))
        await db.commit()
    from cryptography.hazmat.primitives import serialization
    key = serialization.load_pem_private_key(pem.encode(), password=None)
    raw = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return pem, base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


async def public_key(db) -> str:
    return (await _keys(db))[1]


async def subscribe(db, sub: dict, user_agent: str = "") -> None:
    endpoint, keys = sub.get("endpoint"), sub.get("keys") or {}
    if not endpoint or not str(endpoint).startswith("https://") or not keys.get("p256dh") or not keys.get("auth"):
        raise ValueError("That isn't a push subscription.")
    from datetime import datetime, timezone
    await db.execute(
        "INSERT OR REPLACE INTO push_subscriptions (endpoint, keys, created_at, user_agent) VALUES (?,?,?,?)",
        (endpoint, json.dumps({"p256dh": keys["p256dh"], "auth": keys["auth"]}),
         datetime.now(timezone.utc).isoformat(), (user_agent or "")[:200]),
    )
    await db.commit()


async def unsubscribe(db, endpoint: str) -> None:
    await db.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (endpoint,))
    await db.commit()


async def is_subscribed(db, endpoint: str) -> bool:
    async with db.execute("SELECT 1 FROM push_subscriptions WHERE endpoint=?", (endpoint,)) as c:
        return await c.fetchone() is not None


def _send(sub: dict, payload: str, pem: str):
    from py_vapid import Vapid02
    from pywebpush import webpush
    return webpush(sub, data=payload, vapid_private_key=Vapid02.from_pem(pem.encode()),
                   vapid_claims={"sub": CONTACT}, ttl=24 * 3600, timeout=10)


async def notify(db, title: str, body: str, tag: str | None = None, url: str | None = None) -> int:
    """Send to every subscribed browser. Returns how many took it."""
    async with db.execute("SELECT endpoint, keys FROM push_subscriptions") as c:
        subs = [(r[0], json.loads(r[1])) for r in await c.fetchall()]
    if not subs:
        return 0
    pem, _ = await _keys(db)
    payload = json.dumps({"title": title, "body": body, "tag": tag, "url": url or "/atlas/"})
    sent = 0
    for endpoint, keys in subs:
        try:
            await asyncio.to_thread(_send, {"endpoint": endpoint, "keys": keys}, payload, pem)
            sent += 1
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                await unsubscribe(db, endpoint)
            else:
                log.warning("Push to %s… failed: %s", endpoint[:40], exc)
    return sent
