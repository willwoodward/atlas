"""
Credential encryption at rest.

The guarantee under test is narrow and worth stating: a copy of atlas.db taken
without the environment must not yield working credentials to GitHub or Google.
It says nothing about someone with root on the live host, who can read the key.
"""
import importlib

import pytest


@pytest.fixture
def cipher(monkeypatch):
    """A crypto module with a key configured, since the real one reads env at import."""
    monkeypatch.setenv("ATLAS_ENCRYPTION_KEY", "0123456789abcdef" * 4)
    import crypto
    importlib.reload(crypto)
    yield crypto
    monkeypatch.delenv("ATLAS_ENCRYPTION_KEY", raising=False)
    importlib.reload(crypto)


def test_roundtrip(cipher):
    assert cipher.dec(cipher.enc("ghp_realtoken")) == "ghp_realtoken"


def test_ciphertext_does_not_contain_the_secret(cipher):
    """The point of the exercise: grepping the DB file must not find it."""
    stored = cipher.enc("ghp_realtoken")
    assert "ghp_realtoken" not in stored
    assert stored.startswith("enc:v1:")


def test_encryption_is_non_deterministic(cipher):
    """Two encryptions of one value differ, so equal secrets are not detectable."""
    assert cipher.enc("same") != cipher.enc("same")


def test_plaintext_written_before_a_key_existed_still_reads(cipher):
    assert cipher.dec("legacy-plaintext-token") == "legacy-plaintext-token"


def test_encrypting_twice_is_a_no_op(cipher):
    once = cipher.enc("token")
    assert cipher.enc(once) == once


def test_undecryptable_value_disconnects_rather_than_crashes(cipher):
    """After key rotation the integration should fail, not every request."""
    assert cipher.dec("enc:v1:gAAAAABnevervalid") is None


def test_without_a_key_values_pass_through():
    import crypto
    importlib.reload(crypto)
    assert crypto.is_enabled() is False
    assert crypto.enc("token") == "token"
    assert crypto.dec("token") == "token"


def test_empty_and_none_are_left_alone(cipher):
    assert cipher.enc(None) is None
    assert cipher.enc("") == ""
    assert cipher.dec(None) is None


async def test_github_token_is_ciphertext_in_the_database(client, auth, monkeypatch):
    """End-to-end: store a PAT through the API, then read the raw column."""
    monkeypatch.setenv("ATLAS_ENCRYPTION_KEY", "0123456789abcdef" * 4)
    import crypto, routers.integrations as integrations
    importlib.reload(crypto)
    monkeypatch.setattr(integrations, "enc", crypto.enc)
    monkeypatch.setattr(integrations, "dec", crypto.dec)

    resp = await client.put("/api/integrations/github",
                            json={"token": "ghp_supersecret", "repo": "me/notes"}, headers=auth)
    assert resp.status_code == 200

    import aiosqlite
    from database import DATABASE_PATH
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT github_token FROM user_integrations") as cur:
            raw = (await cur.fetchone())["github_token"]

    assert "ghp_supersecret" not in raw
    assert raw.startswith("enc:v1:")

    # ...and the API still hands the real value back to the owner.
    got = (await client.get("/api/integrations", headers=auth)).json()
    assert got["github"]["token"] == "ghp_supersecret"

    importlib.reload(crypto)
