"""
The guarantees that keep the coding agent off main.

These were verified by hand when the code was written, which is not the same as
being enforced. Everything here protects a property that is invisible in normal
operation and only shows up the day it breaks — so it belongs in a test rather
than in someone's memory of a conversation.
"""
import os
import subprocess
from pathlib import Path

import pytest

import workspace as w



@pytest.fixture
def repo(tmp_path, monkeypatch):
    """A local git repo standing in for a clone, with no remote."""
    monkeypatch.setenv("GITHUB_PAT", "github_pat_TESTVALUE")
    monkeypatch.setattr(w, "WORKSPACE", tmp_path)

    path = tmp_path / "owner__repo"
    path.mkdir(parents=True)
    run = lambda *a: subprocess.run(a, cwd=path, check=True, capture_output=True)
    run("git", "init", "-q", "-b", "main", ".")
    run("git", "config", "user.email", "t@t")
    run("git", "config", "user.name", "t")
    (path / "a.txt").write_text("hello")
    run("git", "add", "-A")
    run("git", "commit", "-qm", "init")
    return path


class TestProtectedBranches:
    @pytest.mark.parametrize("branch", ["main", "Main", "MAIN", "master", "MASTER",
                                        "trunk", "develop", "release"])
    def test_protected_names_are_refused(self, branch):
        with pytest.raises(w.WorkspaceError, match="protected branch"):
            w._check_branch(branch)

    @pytest.mark.parametrize("branch", ["atlas/add-tests", "atlas/main-menu-fix", "feature/x"])
    def test_ordinary_branches_are_allowed(self, branch):
        w._check_branch(branch)  # must not raise

    async def test_commit_refuses_while_on_main(self, repo):
        """The check reads the live branch, so switching branches cannot fool it."""
        (repo / "b.txt").write_text("agent edit")
        with pytest.raises(w.WorkspaceError, match="protected branch"):
            await w.commit_and_push("owner/repo", "sneak onto main")

    async def test_refusing_leaves_the_work_uncommitted_rather_than_lost(self, repo):
        (repo / "b.txt").write_text("agent edit")
        with pytest.raises(w.WorkspaceError):
            await w.commit_and_push("owner/repo", "sneak onto main")

        status = subprocess.run(["git", "status", "--porcelain"], cwd=repo,
                                capture_output=True, text=True).stdout
        assert "b.txt" in status
        count = subprocess.run(["git", "rev-list", "--count", "HEAD"], cwd=repo,
                               capture_output=True, text=True).stdout.strip()
        assert count == "1"

    async def test_commit_on_a_feature_branch_is_allowed_up_to_the_push(self, repo):
        """Everything before the network call must work on a normal branch."""
        subprocess.run(["git", "checkout", "-q", "-b", "atlas/work"], cwd=repo, check=True)
        (repo / "b.txt").write_text("agent edit")
        # No remote configured, so this fails at push — but it must reach push,
        # meaning the branch guard did not block it.
        with pytest.raises(w.WorkspaceError, match="git push"):
            await w.commit_and_push("owner/repo", "Add b")

        count = subprocess.run(["git", "rev-list", "--count", "HEAD"], cwd=repo,
                               capture_output=True, text=True).stdout.strip()
        assert count == "2", "the commit itself should have succeeded"


class TestScratchDirectory:
    """The layout harness lives in the clone but must never reach the PR.

    `git add -A` is deliberately broad — it is what makes "commit whatever the
    sandbox changed" work at all — so the only thing standing between a
    throwaway HTML rig and the user's diff is the exclude pathspec.
    """

    async def test_scratch_only_changes_do_not_count_as_work(self, repo):
        subprocess.run(["git", "checkout", "-q", "-b", "atlas/work"], cwd=repo, check=True)
        scratch = repo / w.SCRATCH_DIR
        scratch.mkdir()
        (scratch / "harness.html").write_text("<div>rig</div>")

        result = await w.commit_and_push("owner/repo", "should be a no-op")
        assert result["committed"] is False
        assert "No changes" in result["detail"]

    async def test_scratch_is_left_out_of_a_real_commit(self, repo):
        subprocess.run(["git", "checkout", "-q", "-b", "atlas/work"], cwd=repo, check=True)
        scratch = repo / w.SCRATCH_DIR
        scratch.mkdir()
        (scratch / "harness.html").write_text("<div>rig</div>")
        (repo / "b.txt").write_text("the actual change")

        # No remote, so this reaches push and fails there — the commit is made.
        with pytest.raises(w.WorkspaceError, match="git push"):
            await w.commit_and_push("owner/repo", "Add b")

        tracked = subprocess.run(["git", "show", "--name-only", "--pretty=", "HEAD"],
                                 cwd=repo, capture_output=True, text=True).stdout
        assert "b.txt" in tracked
        assert w.SCRATCH_DIR not in tracked

        # And it is still on disk — excluded, not cleaned up behind the agent.
        assert (scratch / "harness.html").exists()


class TestOwnershipHandling:
    """Regression: the clone is chowned to the sandbox uid so `coder` can edit
    it, but git here runs as root. Without safe.directory git refuses the repo
    with "detected dubious ownership" and every command after prepare_repo
    fails — which showed up as an agent that committed four times and saved
    nothing."""

    async def test_git_runs_with_safe_directory(self, repo, monkeypatch):
        seen = {}

        async def fake_exec(*args, **kwargs):
            seen["argv"] = args

            class Proc:
                returncode = 0
                async def communicate(self):
                    return b"main", b""

            return Proc()

        monkeypatch.setattr("asyncio.create_subprocess_exec", fake_exec)
        await w._git("status", "--porcelain", cwd=repo)

        argv = seen["argv"]
        assert argv[0] == "git"
        assert "safe.directory=*" in argv, (
            "git must be told the differently-owned clone is safe, or every "
            "command after prepare_repo fails"
        )
        assert argv.index("safe.directory=*") < argv.index("status"), \
            "-c must come before the subcommand"


class TestNoDestructiveOperations:
    """Capabilities that simply do not exist are stronger than ones we ask not to use."""

    def test_source_contains_no_destructive_git_verbs(self):
        src = Path(w.__file__).read_text()
        for forbidden in ["--force", "push -f", "reset --hard", "branch -D",
                          "filter-branch", "rebase", "merge_method", "/merge"]:
            assert forbidden not in src, f"{forbidden} appeared in workspace.py"

    def test_there_is_no_merge_function(self):
        assert not any(n for n in dir(w) if "merge" in n.lower())

    def test_pull_requests_are_opened_as_drafts(self):
        """A draft PR cannot be merged until a human marks it ready."""
        assert '"draft": True' in Path(w.__file__).read_text()


class TestBranchNaming:
    def test_the_same_task_twice_yields_different_branches(self, monkeypatch):
        """Reusing a branch name would be a non-fast-forward push we cannot force."""
        import secrets
        a = f"{w.BRANCH_PREFIX}/{w._slugify('Add tests')}-{secrets.token_hex(2)}"
        b = f"{w.BRANCH_PREFIX}/{w._slugify('Add tests')}-{secrets.token_hex(2)}"
        assert a != b

    @pytest.mark.parametrize("task,expected", [
        ("Add dark mode toggle", "add-dark-mode-toggle"),
        ("Fix bug in /api/todos!!", "fix-bug-in-api-todos"),
        ("", "task"),
        ("!!!", "task"),
    ])
    def test_slugs_are_safe_branch_components(self, task, expected):
        assert w._slugify(task) == expected

    def test_slugs_are_bounded(self):
        assert len(w._slugify("word " * 100)) <= 40


class TestCredentialHandling:
    def test_the_token_never_reaches_the_askpass_script(self, monkeypatch, tmp_path):
        monkeypatch.setenv("GITHUB_PAT", "github_pat_SECRET")
        monkeypatch.setattr(w, "_askpass_script", lambda: _write_askpass(tmp_path))
        body = _write_askpass(tmp_path).read_text()
        assert "github_pat_SECRET" not in body
        assert "$GITHUB_PAT" in body

    def test_errors_are_redacted(self, monkeypatch):
        monkeypatch.setenv("GITHUB_PAT", "github_pat_SECRET")
        message = "remote: denied for https://x-access-token:github_pat_SECRET@github.com/o/r"
        assert "github_pat_SECRET" not in w._redact(message)
        assert "***" in w._redact(message)

    def test_a_missing_token_fails_loudly(self, monkeypatch):
        monkeypatch.delenv("GITHUB_PAT", raising=False)
        with pytest.raises(w.WorkspaceError, match="GITHUB_PAT is not set"):
            w._pat()


class TestRepoValidation:
    @pytest.mark.parametrize("bad", ["not-a-repo", "a/b/c", "", "../etc/passwd",
                                     "owner/repo; rm -rf /", "https://github.com/o/r"])
    async def test_malformed_repo_names_are_refused(self, bad, monkeypatch):
        monkeypatch.setenv("GITHUB_PAT", "x")
        with pytest.raises(w.WorkspaceError, match="owner/name"):
            await w.prepare_repo(bad, "some task")

    def test_repo_dir_cannot_escape_the_workspace(self, monkeypatch, tmp_path):
        monkeypatch.setattr(w, "WORKSPACE", tmp_path)
        path = w.repo_dir("owner/repo")
        assert path.parent == tmp_path


def _write_askpass(tmp_path: Path) -> Path:
    """The real askpass body, written somewhere harmless for inspection."""
    path = tmp_path / "askpass.sh"
    path.write_text(
        "#!/bin/sh\n"
        'case "$1" in\n'
        "  *Username*) printf '%s' \"x-access-token\" ;;\n"
        "  *) printf '%s' \"$GITHUB_PAT\" ;;\n"
        "esac\n"
    )
    return path


class TestRefValidation:
    """Branch names arriving from the GitHub API or the model are arguments to
    git and path segments in API URLs, so they are validated rather than escaped."""

    @pytest.mark.parametrize("bad", [
        "", "--upload-pack=evil", "a..b", "feature/x.lock", "has space",
        "trailing/", "semi;colon", "main", "MASTER",
    ])
    def test_unusable_refs_are_refused(self, bad):
        with pytest.raises(w.WorkspaceError):
            w._check_ref(bad)

    @pytest.mark.parametrize("good", ["atlas/add-tests-ab12", "feature/x", "fix.1"])
    def test_ordinary_refs_are_allowed(self, good):
        w._check_ref(good)


class TestResumeGuards:
    """Revising a PR checks out an existing branch — the one path that touches a
    branch this agent did not create."""

    async def test_a_protected_branch_is_refused_before_any_clone(self, monkeypatch):
        async def explode(*a, **k):
            raise AssertionError("git must not run for a protected branch")
        monkeypatch.setattr(w, "_git", explode)
        with pytest.raises(w.WorkspaceError, match="protected branch"):
            await w.resume_branch("owner/repo", "main")

    async def test_a_malformed_repo_is_refused(self, monkeypatch):
        async def explode(*a, **k):
            raise AssertionError("git must not run for a malformed repo")
        monkeypatch.setattr(w, "_git", explode)
        with pytest.raises(w.WorkspaceError, match="owner/name"):
            await w.resume_branch("not-a-repo", "atlas/x")


def _stub_api(monkeypatch, responses: dict):
    """Serve canned GitHub responses, matching on a substring of the path."""
    calls = []

    async def fake(path, *, method="GET", payload=None, timeout=60):
        calls.append({"path": path, "method": method, "payload": payload})
        for fragment, body in responses.items():
            if fragment in path:
                if isinstance(body, Exception):
                    raise body
                return body
        return {}

    monkeypatch.setattr(w, "_api", fake)
    return calls


def _pr(**over):
    base = {"number": 7, "html_url": "https://github.com/owner/repo/pull/7",
            "title": "t", "body": "b", "state": "open", "draft": True,
            "head": {"ref": "atlas/x", "repo": {"full_name": "owner/repo"}},
            "base": {"ref": "main"}}
    base.update(over)
    return base


class TestPullRequestLookup:
    async def test_an_open_pr_yields_its_branch_and_base(self, monkeypatch):
        _stub_api(monkeypatch, {"/pulls/7": _pr()})
        pr = await w.fetch_pr("owner/repo", 7)
        assert pr["branch"] == "atlas/x"
        assert pr["base"] == "main"
        assert pr["draft"] is True

    async def test_a_closed_pr_is_refused(self, monkeypatch):
        _stub_api(monkeypatch, {"/pulls/7": _pr(state="closed")})
        with pytest.raises(w.WorkspaceError, match="closed"):
            await w.fetch_pr("owner/repo", 7)

    async def test_a_merged_pr_says_merged(self, monkeypatch):
        _stub_api(monkeypatch, {"/pulls/7": _pr(state="closed", merged=True)})
        with pytest.raises(w.WorkspaceError, match="merged"):
            await w.fetch_pr("owner/repo", 7)

    async def test_a_fork_pr_is_refused(self, monkeypatch):
        """The PAT has no write access to a fork, so this would fail after the
        work was already done rather than before it started."""
        _stub_api(monkeypatch, {"/pulls/7": _pr(
            head={"ref": "x", "repo": {"full_name": "someone/repo"}})})
        with pytest.raises(w.WorkspaceError, match="fork"):
            await w.fetch_pr("owner/repo", 7)

    async def test_a_missing_pr_is_reported_plainly(self, monkeypatch):
        _stub_api(monkeypatch, {"/pulls/7": w.GitHubApiError(404, "Not Found")})
        with pytest.raises(w.WorkspaceError, match="No pull request #7"):
            await w.fetch_pr("owner/repo", 7)


class TestPullRequestFeedback:
    def _sources(self):
        return {
            "/reviews": [
                {"body": "Needs a test.", "state": "CHANGES_REQUESTED",
                 "user": {"login": "will"}, "submitted_at": "2026-01-02T00:00:00Z"},
                {"body": "", "state": "APPROVED", "user": {"login": "will"},
                 "submitted_at": "2026-01-03T00:00:00Z"},
            ],
            "/pulls/7/comments": [
                {"body": "this leaks", "user": {"login": "will"},
                 "created_at": "2026-01-01T00:00:00Z",
                 "path": "agent/coding.py", "line": 42, "diff_hunk": "@@ -1 +1 @@"},
            ],
            "/issues/7/comments": [
                {"body": f"Atlas is revising this\n\n{w.AGENT_COMMENT_MARKER}",
                 "user": {"login": "will"}, "created_at": "2026-01-04T00:00:00Z"},
                {"body": "also rename it", "user": {"login": "will"},
                 "created_at": "2026-01-05T00:00:00Z"},
            ],
        }

    async def test_feedback_is_ordered_oldest_first(self, monkeypatch):
        _stub_api(monkeypatch, self._sources())
        items = await w.fetch_pr_feedback("owner/repo", 7)
        assert [i["body"] for i in items] == ["this leaks", "Needs a test.", "also rename it"]

    async def test_the_agents_own_comments_are_not_fed_back_to_it(self, monkeypatch):
        """The PAT acts as the user, so author login cannot tell them apart —
        without the marker the agent would treat its own progress notes as review."""
        _stub_api(monkeypatch, self._sources())
        items = await w.fetch_pr_feedback("owner/repo", 7)
        assert not any(w.AGENT_COMMENT_MARKER in i["body"] for i in items)

    async def test_empty_review_bodies_are_dropped(self, monkeypatch):
        _stub_api(monkeypatch, self._sources())
        items = await w.fetch_pr_feedback("owner/repo", 7)
        assert all(i["body"].strip() for i in items)

    async def test_inline_comments_keep_their_anchor(self, monkeypatch):
        """An inline "this is wrong" is unresolvable without the file and hunk."""
        _stub_api(monkeypatch, self._sources())
        inline = next(i for i in await w.fetch_pr_feedback("owner/repo", 7) if i["kind"] == "inline")
        assert inline["path"] == "agent/coding.py"
        assert inline["line"] == 42
        assert inline["hunk"] == "@@ -1 +1 @@"

    async def test_no_feedback_is_an_empty_list_not_an_error(self, monkeypatch):
        _stub_api(monkeypatch, {"/reviews": [], "/comments": []})
        assert await w.fetch_pr_feedback("owner/repo", 7) == []


class TestPullRequestComments:
    async def test_comments_are_marked_so_they_can_be_filtered_later(self, monkeypatch):
        calls = _stub_api(monkeypatch, {})
        await w.comment_on_pr("owner/repo", 7, "done")
        assert calls[0]["method"] == "POST"
        assert calls[0]["path"] == "/repos/owner/repo/issues/7/comments"
        assert w.AGENT_COMMENT_MARKER in calls[0]["payload"]["body"]

    async def test_a_failed_comment_never_fails_the_run(self, monkeypatch):
        """The work is already pushed by then; losing a progress note is not a
        reason to report the run as failed."""
        _stub_api(monkeypatch, {"/comments": w.GitHubApiError(403, "denied")})
        await w.comment_on_pr("owner/repo", 7, "done")  # must not raise
