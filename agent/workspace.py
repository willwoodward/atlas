"""
Git operations for the coding agent — all of them, deliberately.

The sandbox container never contacts a git remote. If it did, the PAT would have
to live in there, and a `git clone https://token@github.com/...` writes that
token into `.git/config` where any code the agent runs could read it. So the
split is: this container owns the network side (clone, commit, push, PR) and the
sandbox owns only the filesystem side (edit, build, test), sharing /workspace.

The PAT is never written to disk here either. Git asks for credentials through
GIT_ASKPASS, which we point at a tiny script that echoes them from the
environment — so the token exists in process memory and nowhere else.

main is off limits. Not by convention but by construction: every entry point
refuses a protected branch, and nothing here can force-push, delete a branch or
rewrite history.
"""
import asyncio
import json
import logging
import os
import re
import secrets
import shutil
import urllib.error
import urllib.request
from pathlib import Path

log = logging.getLogger("atlas.agent.workspace")

WORKSPACE = Path(os.getenv("WORKSPACE_DIR", "/workspace"))
BRANCH_PREFIX = os.getenv("CODING_BRANCH_PREFIX", "atlas")

# Never checked out, never committed to, never pushed to. `git push` to any of
# these raises before a network call happens.
PROTECTED_BRANCHES = {"main", "master", "trunk", "develop", "release"}

# Commit authorship, so a glance at the history says who wrote what.
GIT_AUTHOR_NAME = os.getenv("CODING_AUTHOR_NAME", "Atlas Agent")
GIT_AUTHOR_EMAIL = os.getenv("CODING_AUTHOR_EMAIL", "atlas-agent@users.noreply.github.com")

REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
GIT_TIMEOUT = 300  # seconds; a shallow clone of a large repo on 1 vCPU is slow


class WorkspaceError(RuntimeError):
    """A git operation failed, or was refused for being unsafe."""


def _pat() -> str:
    token = os.getenv("GITHUB_PAT", "")
    if not token:
        raise WorkspaceError(
            "GITHUB_PAT is not set on the agent container — cannot clone or push."
        )
    return token


def _askpass_script() -> Path:
    """Write the credential helper git will call. Contains no secret itself.

    The token is read from the environment at call time, so it never lands in a
    file, in `.git/config`, or in a command line visible via `ps`.
    """
    path = Path("/tmp/atlas-askpass.sh")
    if not path.exists():
        path.write_text(
            "#!/bin/sh\n"
            # Git asks for Username first, then Password. x-access-token is the
            # username GitHub expects when the password is a PAT.
            'case "$1" in\n'
            "  *Username*) printf '%s' \"x-access-token\" ;;\n"
            "  *) printf '%s' \"$GITHUB_PAT\" ;;\n"
            "esac\n"
        )
        path.chmod(0o700)
    return path


def _git_env() -> dict:
    env = os.environ.copy()
    env.update({
        "GIT_ASKPASS": str(_askpass_script()),
        "GITHUB_PAT": _pat(),
        "GIT_TERMINAL_PROMPT": "0",       # fail instead of hanging on a prompt
        "GIT_AUTHOR_NAME": GIT_AUTHOR_NAME,
        "GIT_AUTHOR_EMAIL": GIT_AUTHOR_EMAIL,
        "GIT_COMMITTER_NAME": GIT_AUTHOR_NAME,
        "GIT_COMMITTER_EMAIL": GIT_AUTHOR_EMAIL,
    })
    return env


def _redact(text: str) -> str:
    """Strip the token from anything that might be shown or logged."""
    token = os.getenv("GITHUB_PAT", "")
    return text.replace(token, "***") if token else text


async def _git(*args: str, cwd: Path | None = None) -> str:
    # safe.directory is required because the clone is chowned to the sandbox's
    # uid (so `coder` can edit it) while git here runs as root. Without it git
    # refuses the repo outright with "detected dubious ownership", and every
    # command after prepare_repo fails — silently, from the agent's point of
    # view, because it only sees a tool error.
    proc = await asyncio.create_subprocess_exec(
        "git", "-c", "safe.directory=*", *args,
        cwd=str(cwd) if cwd else None,
        env=_git_env(),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=GIT_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        raise WorkspaceError(f"git {args[0]} timed out after {GIT_TIMEOUT}s")
    text = _redact(out.decode(errors="replace").strip())
    if proc.returncode != 0:
        raise WorkspaceError(f"git {args[0]} failed: {text[:500]}")
    return text


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return (slug[:40].rstrip("-")) or "task"


def _check_branch(branch: str) -> None:
    if branch.lower() in PROTECTED_BRANCHES:
        raise WorkspaceError(
            f"Refusing to operate on protected branch '{branch}'. "
            "The agent works on its own branch and opens a pull request."
        )


def repo_dir(repo: str) -> Path:
    return WORKSPACE / repo.replace("/", "__")


async def prepare_repo(repo: str, task: str) -> dict:
    """Clone `owner/name` into the workspace and check out a fresh branch.

    Returns the sandbox-visible path and the branch name. The branch is pushed
    immediately, before any work happens, so that a run which dies mid-task
    still leaves something on the remote to look at.
    """
    if not REPO_RE.match(repo or ""):
        raise WorkspaceError(f"Expected a repository as 'owner/name', got '{repo}'.")

    dest = repo_dir(repo)
    url = f"https://github.com/{repo}.git"

    # Start from a clean tree every time. Reusing a working copy across tasks
    # means one run's half-finished edits leak into the next one's diff.
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)
    dest.parent.mkdir(parents=True, exist_ok=True)

    # Shallow: history is weight the agent never reads, and this box has 1 vCPU.
    await _git("clone", "--depth", "1", url, str(dest))

    default = await _git("rev-parse", "--abbrev-ref", "HEAD", cwd=dest)
    # Unique suffix, because the same task asked twice would otherwise generate
    # the same branch name — and the second run's branch starts from the default
    # branch, so pushing it over the first run's commits is a non-fast-forward.
    # We have no force-push by design, so that failure would be unrecoverable.
    # A fresh branch per run also keeps an interrupted attempt's work intact.
    branch = f"{BRANCH_PREFIX}/{_slugify(task)}-{secrets.token_hex(2)}"
    _check_branch(branch)
    if branch == default:
        raise WorkspaceError(f"Branch name collides with the default branch '{default}'.")

    await _git("checkout", "-b", branch, cwd=dest)
    await _git("push", "--set-upstream", "origin", branch, cwd=dest)

    # The sandbox writes as `coder`; this container clones as root.
    _grant_sandbox_access(dest)

    log.info("Prepared %s on branch %s (default=%s)", repo, branch, default)
    return {"repo": repo, "path": str(dest), "branch": branch, "default_branch": default}


def _grant_sandbox_access(path: Path) -> None:
    """Hand the clone to the sandbox's uid so `coder` can edit it."""
    uid = int(os.getenv("SANDBOX_UID", "1000"))
    for p in [path, *path.rglob("*")]:
        try:
            os.chown(p, uid, uid)
        except (PermissionError, OSError):  # best effort; surfaces as a write error later
            pass


async def commit_and_push(repo: str, message: str) -> dict:
    """Commit whatever the sandbox changed and push it.

    Called after each meaningful step rather than once at the end — a run that
    dies at minute 18 should leave the work that existed at minute 12.
    """
    dest = repo_dir(repo)
    if not dest.exists():
        raise WorkspaceError(f"{repo} is not checked out — call prepare_repo first.")

    branch = await _git("rev-parse", "--abbrev-ref", "HEAD", cwd=dest)
    _check_branch(branch)

    status = await _git("status", "--porcelain", cwd=dest)
    if not status.strip():
        return {"committed": False, "branch": branch, "detail": "No changes to commit."}

    await _git("add", "-A", cwd=dest)
    await _git("commit", "-m", message or "Work in progress", cwd=dest)
    await _git("push", "origin", branch, cwd=dest)

    sha = await _git("rev-parse", "--short", "HEAD", cwd=dest)
    files = len([l for l in status.splitlines() if l.strip()])
    log.info("Pushed %s to %s (%d files)", sha, branch, files)
    return {"committed": True, "branch": branch, "sha": sha, "files_changed": files}


async def diff_summary(repo: str) -> str:
    """Compact view of what has changed, for the agent's own summary."""
    dest = repo_dir(repo)
    if not dest.exists():
        return ""
    return await _git("diff", "--stat", "HEAD", cwd=dest)


async def open_pull_request(repo: str, branch: str, title: str, body: str, base: str) -> dict:
    """Open a PR from the agent's branch. Opening only — never merging.

    There is deliberately no merge function in this module. The PAT is capable
    of merging (that needs only contents:write), so the guarantee that nothing
    reaches main without the user cannot come from the token — it comes from
    this code having no such call, backed by a branch protection ruleset on the
    remote. See docs/INFRA.md.
    """
    _check_branch(branch)
    if branch == base:
        raise WorkspaceError(f"Refusing to open a PR from '{branch}' onto itself.")

    payload = json.dumps({
        "title": title[:250] or f"Atlas: {branch}",
        "head": branch,
        "base": base,
        "body": body[:60000],
        # A draft PR cannot be merged until a human marks it ready, which makes
        # accidental automation one step further away from main.
        "draft": True,
    }).encode()

    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/pulls",
        data=payload,
        headers={
            "Authorization": f"Bearer {_pat()}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.load(resp)
        return {"url": data.get("html_url"), "number": data.get("number"), "draft": True}
    except urllib.error.HTTPError as exc:
        detail = _redact(exc.read().decode(errors="replace"))[:400]
        if exc.code == 422 and "already exists" in detail:
            # Re-running against the same branch is normal; find the open PR.
            existing = await _find_open_pr(repo, branch)
            if existing:
                return existing
        raise WorkspaceError(f"Could not open a pull request ({exc.code}): {detail}")


async def _find_open_pr(repo: str, branch: str) -> dict | None:
    owner = repo.split("/")[0]
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/pulls?head={owner}:{branch}&state=open",
        headers={"Authorization": f"Bearer {_pat()}", "Accept": "application/vnd.github+json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            items = json.load(resp)
        if items:
            return {"url": items[0].get("html_url"), "number": items[0].get("number"),
                    "draft": items[0].get("draft", False)}
    except Exception:
        log.debug("Could not look up existing PR", exc_info=True)
    return None
