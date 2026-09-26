"""
Encryption at rest for stored third-party credentials.

Scope, stated honestly: the API decrypts on nearly every request, so the key
lives on the same host as the database. This protects a *copy* of the data —
a stolen backup, a disk snapshot, a leaked volume, a `.db` file lifted without
the environment — and it does not protect against someone who already has root
on the running box. That is still worth having, because copies of the database
travel and the live host does not.

What is encrypted: credentials to other systems (the GitHub PAT, Google refresh
and access tokens). Those are the worst thing in this database — they grant
access somewhere else, and they are useless to the app as anything but opaque
blobs, so encrypting them costs nothing.

What is deliberately *not* encrypted: transaction rows. Amounts and dates are
summed, grouped and range-scanned in SQL; encrypting them would move every
aggregate into Python and still leak the shape of the data through row counts
and timestamps. For financial rows the effective control is an encrypted backup
(see docs/INFRA.md) plus the auth boundary, not per-column ciphertext that
breaks every query while looking reassuring.
"""
import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

_PREFIX = "enc:v1:"

ENCRYPTION_KEY = os.getenv("ATLAS_ENCRYPTION_KEY", "").strip()


def _fernet() -> Fernet | None:
    if not ENCRYPTION_KEY:
        return None
    # Accept either a real Fernet key or any sufficiently long passphrase, so a
    # value from `openssl rand -hex 32` works without extra ceremony.
    try:
        return Fernet(ENCRYPTION_KEY)
    except (ValueError, TypeError):
        digest = hashlib.sha256(ENCRYPTION_KEY.encode()).digest()
        return Fernet(base64.urlsafe_b64encode(digest))


_cipher = _fernet()


def is_enabled() -> bool:
    return _cipher is not None


def enc(value: str | None) -> str | None:
    """Encrypt a secret for storage. A no-op when no key is configured, so an
    existing deployment keeps working until the key is set."""
    if value is None or value == "" or _cipher is None:
        return value
    if value.startswith(_PREFIX):
        return value
    return _PREFIX + _cipher.encrypt(value.encode()).decode()


def dec(value: str | None) -> str | None:
    """Decrypt a stored secret.

    Plaintext is passed through: rows written before a key existed must keep
    working, and the prefix is what distinguishes the two. A value that claims
    to be encrypted but will not decrypt returns None rather than raising — a
    rotated-away key should disconnect the integration, not crash every request
    that touches it.
    """
    if not value:
        return value
    if not value.startswith(_PREFIX):
        return value
    if _cipher is None:
        return None
    try:
        return _cipher.decrypt(value[len(_PREFIX):].encode()).decode()
    except InvalidToken:
        return None


SECRET_COLUMNS = ("github_token", "gcal_refresh_token", "gcal_access_token")


async def encrypt_existing_secrets(db) -> int:
    """Bring plaintext rows up to date after a key is first configured."""
    if _cipher is None:
        return 0
    updated = 0
    async with db.execute(f"SELECT email, {', '.join(SECRET_COLUMNS)} FROM user_integrations") as cur:
        rows = [dict(r) for r in await cur.fetchall()]
    for row in rows:
        changes = {c: enc(row[c]) for c in SECRET_COLUMNS
                   if row[c] and not row[c].startswith(_PREFIX)}
        if not changes:
            continue
        sets = ", ".join(f"{c} = ?" for c in changes)
        await db.execute(f"UPDATE user_integrations SET {sets} WHERE email = ?",
                         (*changes.values(), row["email"]))
        updated += 1
    if updated:
        await db.commit()
    return updated
