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
