"""
Coding is off by default, and "off" has to mean the agent cannot change code.

Three independent layers are tested, because any one of them alone has a way
around it: the tool not being offered to the model, the tool refusing if it is
called anyway, and the GitHub credential being absent from the process.
"""
import importlib
import os

import pytest

import coding


@pytest.fixture
def fresh(monkeypatch):
    """Re-import the modules with a given env, as the container would at boot."""
    def load(flag, pat="ghp_notarealtoken"):
        if flag is None:
            monkeypatch.delenv("ATLAS_AGENT_CODING", raising=False)
        else:
            monkeypatch.setenv("ATLAS_AGENT_CODING", flag)
        monkeypatch.setenv("GITHUB_PAT", pat)
        import runtime
        importlib.reload(coding)
        importlib.reload(runtime)
        return coding, runtime
    yield load
    monkeypatch.delenv("ATLAS_AGENT_CODING", raising=False)
    importlib.reload(coding)


@pytest.mark.parametrize("flag", [None, "", "off", "false", "0", "nonsense"])
def test_coding_is_off_unless_explicitly_on(fresh, flag):
    c, _ = fresh(flag)
    assert c.CODING_ENABLED is False


@pytest.mark.parametrize("flag", ["on", "true", "1", "YES"])
def test_it_can_be_turned_on(fresh, flag):
    c, _ = fresh(flag)
    assert c.CODING_ENABLED is True


def test_the_pat_is_removed_from_the_process_when_off(fresh):
    """A credential that is not in the environment can't be read by any tool."""
    fresh("off")
    assert "GITHUB_PAT" not in os.environ


def test_the_pat_is_kept_when_on(fresh):
    fresh("on")
    assert os.environ.get("GITHUB_PAT") == "ghp_notarealtoken"


async def test_the_tool_refuses_before_touching_anything(fresh, monkeypatch):
    c, _ = fresh("off")
    touched = []
    for name in ("prepare_repo", "resume_branch", "fetch_pr", "commit_and_push", "open_pull_request"):
        monkeypatch.setattr(c.workspace, name, lambda *a, _n=name, **k: touched.append(_n))
    monkeypatch.setattr(c, "build_sandbox", lambda *a, **k: touched.append("sandbox"))

    fn = getattr(c.delegate_coding, "_tool_func", None) or c.delegate_coding
    result = await fn(repo="willwoodward/atlas", task="delete everything")
    assert result["status"] == "disabled"
    assert touched == []


def test_the_prompt_does_not_offer_coding_when_off(fresh):
    _, rt = fresh("off")
    prompt = rt.SYSTEM_PROMPT.format(name="Will", today="today", coding=rt.CODING_DISABLED_SECTION)
    assert "delegate_coding" not in prompt
    assert "switched off" in prompt


def test_the_prompt_still_explains_coding_when_on(fresh):
    _, rt = fresh("on")
    prompt = rt.SYSTEM_PROMPT.format(name="Will", today="today", coding=rt.CODING_SECTION)
    assert "delegate_coding" in prompt


def test_http_request_cannot_borrow_env_credentials():
    """The other route to a code host: http_request can send a token read from an
    env var, but only for vars on an explicit allowlist. Nothing may be on it."""
    from strands_tools.http_request import HTTP_REQUEST_TOKEN_CONFIG
    assert HTTP_REQUEST_TOKEN_CONFIG == {}


def _names(tools):
    return {getattr(t, "tool_name", None) or getattr(t, "__name__", "") for t in tools}


def test_the_model_is_not_given_the_tool_when_off(fresh):
    _, rt = fresh("off")
    assert "delegate_coding" not in _names(rt.local_tools())
    assert "delegate_research" in _names(rt.local_tools())   # everything else stays


def test_the_model_gets_the_tool_when_on(fresh):
    _, rt = fresh("on")
    assert "delegate_coding" in _names(rt.local_tools())
