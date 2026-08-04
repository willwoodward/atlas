"""
Revising a pull request rather than opening another one.

The failure this guards against is quiet and expensive: a revision that takes the
prepare_repo path cuts a new branch, opens a second pull request, and abandons
the review thread the user was in the middle of. Everything still "works" — you
just end up with two PRs and no feedback attached to the code that answers it.

The model is stubbed out. What is under test is the plumbing around it: which
branch gets checked out, whether a PR is opened, and what is said in the thread.
"""
import pytest

import coding
import workspace as w


class _FakeAgent:
    """Stands in for the coder. Returns a summary without calling a model."""

    last_prompt = ""

    def __init__(self, *args, **kwargs):
        self.kwargs = kwargs
        _FakeAgent.last_prompt = kwargs.get("system_prompt", "")

    async def invoke_async(self, _prompt):
        return "Addressed the review comments."


@pytest.fixture
def stub(monkeypatch):
    """Replace every side effect delegate_coding has, and record the calls."""
    calls = {"opened_prs": [], "comments": [], "resumed": [], "prepared": []}

    async def fetch_pr(repo, number):
        return {"number": number, "url": f"https://github.com/{repo}/pull/{number}",
                "title": "t", "body": "b", "branch": "atlas/x", "base": "main", "draft": True}

    async def fetch_pr_feedback(repo, number):
        return [{"kind": "inline", "author": "will", "created_at": "2026-01-01T00:00:00Z",
                 "body": "rename this", "path": "a.py", "line": 3, "hunk": "@@ -1 +1 @@"}]

    async def resume_branch(repo, branch):
        calls["resumed"].append((repo, branch))
        return {"repo": repo, "path": f"/workspace/{repo}", "branch": branch}

    async def prepare_repo(repo, task):
        calls["prepared"].append((repo, task))
        return {"repo": repo, "path": f"/workspace/{repo}", "branch": "atlas/new-1234",
                "default_branch": "main"}

    async def open_pull_request(repo, branch, title, body, base):
        calls["opened_prs"].append(branch)
        return {"url": f"https://github.com/{repo}/pull/99", "number": 99, "draft": True}

    async def comment_on_pr(repo, number, body):
        calls["comments"].append(body)

    async def commit_and_push(repo, message):
        return {"committed": False, "branch": "atlas/x", "detail": "No changes to commit."}

    async def diff_summary(repo):
        return ""

    for name, fn in [("fetch_pr", fetch_pr), ("fetch_pr_feedback", fetch_pr_feedback),
                     ("resume_branch", resume_branch), ("prepare_repo", prepare_repo),
                     ("open_pull_request", open_pull_request), ("comment_on_pr", comment_on_pr),
                     ("commit_and_push", commit_and_push), ("diff_summary", diff_summary)]:
        monkeypatch.setattr(w, name, fn)

    monkeypatch.setattr(coding, "Agent", _FakeAgent)
    monkeypatch.setattr(coding, "_coder_model", lambda: None)
    monkeypatch.setattr(coding, "build_sandbox",
                        lambda working_dir: type("S", (), {"get_tools": lambda self: []})())

    events = []
    monkeypatch.setattr(coding, "_emit", events.append)
    calls["events"] = events
    return calls


async def _run(**kwargs):
    """delegate_coding is a Strands tool; call the function it wraps."""
    fn = getattr(coding.delegate_coding, "_tool_func", None) or coding.delegate_coding
    return await fn(**kwargs)


class TestRevision:
    async def test_it_resumes_the_prs_branch_instead_of_cutting_a_new_one(self, stub):
        result = await _run(repo="owner/repo", task="address feedback", pr_number=7)
        assert stub["resumed"] == [("owner/repo", "atlas/x")]
        assert stub["prepared"] == []
        assert result["branch"] == "atlas/x"

    async def test_it_does_not_open_a_second_pull_request(self, stub):
        result = await _run(repo="owner/repo", task="address feedback", pr_number=7)
        assert stub["opened_prs"] == []
        assert result["pull_request"] == "https://github.com/owner/repo/pull/7"
        assert result["mode"] == "revision"

    async def test_it_reports_in_the_pr_thread_at_both_ends(self, stub):
        await _run(repo="owner/repo", task="address feedback", pr_number=7)
        assert len(stub["comments"]) == 2
        assert "revising" in stub["comments"][0]
        assert "Addressed the review comments." in stub["comments"][1]

    async def test_the_review_feedback_reaches_the_coders_prompt(self, stub):
        """Fetching the comments is pointless if they do not get into the prompt."""
        await _run(repo="owner/repo", task="address feedback", pr_number=7)
        prompt = _FakeAgent.last_prompt
        assert "rename this" in prompt
        assert "a.py" in prompt
        assert "REVISION" in prompt

    async def test_the_ui_is_told_this_is_a_revision(self, stub):
        await _run(repo="owner/repo", task="address feedback", pr_number=7)
        started = next(e for e in stub["events"] if e["type"] == "coding_started")
        assert started["mode"] == "revision"
        assert started["pr_number"] == 7
        assert started["pr_url"].endswith("/pull/7")

    async def test_an_unusable_pr_costs_nothing(self, stub, monkeypatch):
        """Refused before the clone and the model run, not after."""
        async def refuse(repo, number):
            raise w.WorkspaceError("Pull request #7 is merged")
        monkeypatch.setattr(w, "fetch_pr", refuse)

        result = await _run(repo="owner/repo", task="address feedback", pr_number=7)
        assert result["stage"] == "resume"
        assert stub["resumed"] == [] and stub["comments"] == []


class TestNewWork:
    async def test_new_work_still_opens_a_draft_pr(self, stub):
        result = await _run(repo="owner/repo", task="add a thing")
        assert stub["prepared"] == [("owner/repo", "add a thing")]
        assert stub["opened_prs"] == ["atlas/new-1234"]
        assert result["mode"] == "new"

    async def test_new_work_does_not_comment(self, stub):
        """The summary is already the PR body; a comment repeating it is noise."""
        await _run(repo="owner/repo", task="add a thing")
        assert stub["comments"] == []


class TestPullRequestTitle:
    """The task text is the orchestrator's restatement; the commit subject is the
    engineer's own one-line description. The second makes a far better title."""

    def test_the_first_real_commit_subject_wins(self):
        title = coding._pr_title(
            ["Remove Atlas branding from mobile top bar", "Fix spacing"],
            "Update the Atlas application so that, on mobile viewports, the Atlas "
            "name and Atlas icon are removed from the header. Keep everything else.")
        assert title == "Remove Atlas branding from mobile top bar"

    def test_a_sweep_up_commit_is_not_a_description_of_the_work(self):
        title = coding._pr_title([coding.SWEEP_UP_MESSAGE], "Add a mobile header toggle")
        assert title == "Add a mobile header toggle"

    def test_falling_back_to_the_task_never_cuts_mid_word(self):
        """'...header. Ke-' is what a hard 120-char slice produces."""
        task = ("Update the Atlas application so that, on mobile viewports, the Atlas "
                "name and Atlas icon are removed from the header. Keep the rest as is.")
        title = coding._pr_title([], task)
        assert len(title) <= 121  # the ellipsis is added after the cut
        assert title.endswith("…")
        assert not title.rstrip("…").endswith(("Ke", "-"))
        assert task.startswith(title.rstrip("…").rstrip())

    def test_a_short_task_is_left_alone(self):
        assert coding._pr_title([], "Add tests") == "Add tests"

    def test_there_is_always_a_title(self):
        assert coding._pr_title([], "") == "Atlas change"
