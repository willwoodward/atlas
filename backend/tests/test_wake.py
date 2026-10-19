"""
The wake word's model download (routers/wake.py): repacked from Vosk's zip,
behind a fixed secret key, never fetched from the internet in tests.
"""
import io
import tarfile
import zipfile

import pytest

import routers.wake as wake


def _zip(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    return buf.getvalue()


def test_repacks_the_zip_with_one_top_folder():
    data = wake.repack(_zip({"m/am/final.mdl": b"x", "m/conf/model.conf": b"y", "m/": b""}), "m")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        names = sorted(tar.getnames())
        assert names == ["m", "m/am/final.mdl", "m/conf/model.conf"]
        assert tar.extractfile("m/am/final.mdl").read() == b"x"


def test_refuses_paths_that_escape():
    with pytest.raises(ValueError):
        wake.repack(_zip({"../evil": b"x"}), "m")


@pytest.fixture
def model(tmp_path, monkeypatch):
    monkeypatch.setenv("WAKE_MODEL_DIR", str(tmp_path))
    fetched = []

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            pass

        async def get(self, url):
            fetched.append(url)
            import httpx
            return httpx.Response(200, content=_zip({f"{wake.DEFAULT_MODEL}/conf/model.conf": b"ok"}))
    monkeypatch.setattr(wake.httpx, "AsyncClient", FakeClient)
    return fetched


async def test_signed_in_users_get_a_stable_url(client, auth, model):
    first = (await client.get("/wake/model", headers=auth)).json()
    again = (await client.get("/wake/model", headers=auth)).json()
    assert first["url"] == again["url"] and first["engine"] == "vosk"
    assert (await client.get("/wake/model")).status_code == 401
    resp = await client.get(first["url"])
    assert resp.status_code == 200 and resp.headers["cache-control"].startswith("public")
    with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:gz") as tar:
        assert f"{wake.DEFAULT_MODEL}/conf/model.conf" in tar.getnames()
    # Fetched from Vosk once, then served from disk.
    await client.get(first["url"])
    assert len(model) == 1


async def test_a_wrong_key_or_name_is_not_found(client, model):
    assert (await client.get(f"/wake/model/{'0' * 32}/{wake.DEFAULT_MODEL}.tar.gz")).status_code == 404
    assert (await client.get(f"/wake/model/{wake.url_key()}/other.tar.gz")).status_code == 404
    assert model == []
