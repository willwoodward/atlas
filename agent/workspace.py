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

# Working directory inside the clone for throwaway rigs — never committed.
SCRATCH_DIR = ".atlas-scratch"

# Commit authorship, so a glance at the history says who wrote what.
GIT_AUTHOR_NAME = os.getenv("CODING_AUTHOR_NAME", "Atlas Agent")
GIT_AUTHOR_EMAIL = os.getenv("CODING_AUTHOR_EMAIL", "atlas-agent@users.noreply.github.com")

REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
GIT_TIMEOUT = 300  # seconds; a shallow clone of a large repo on 1 vCPU is slow


# Appended to every comment this module posts, so the next revision run can tell
# the user's feedback from its own chatter. The PAT acts *as the user*, so author
# login cannot distinguish them — there is no other marker available.
AGENT_COMMENT_MARKER = "<!-- atlas-agent -->"

# Refs are passed to git as arguments and interpolated into API paths, so the
# charset is restricted rather than escaped. A leading '-' would be read as a
# flag; '..' is a range expression.
REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$")


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


def _check_ref(branch: str) -> None:
    """Validate a branch name that came from outside — the API, or the model."""
    if not REF_RE.match(branch or ""):
        raise WorkspaceError(f"'{branch}' is not a usable branch name.")
    if ".." in branch or branch.endswith(".lock") or branch.endswith("/"):
        raise WorkspaceError(f"'{branch}' is not a usable branch name.")
    _check_branch(branch)


class GitHubApiError(WorkspaceError):
    """A GitHub REST call returned a non-2xx status."""

    def __init__(self, status: int, detail: str):
        super().__init__(f"GitHub API {status}: {detail}")
        self.status = status
        self.detail = detail


def _api_sync(path: str, *, method: str = "GET", payload: dict | None = None,
              timeout: int = 60):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"Bearer {_pat()}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        raise GitHubApiError(exc.code, _redact(exc.read().decode(errors="replace"))[:400])
    except urllib.error.URLError as exc:
        raise WorkspaceError(f"Could not reach the GitHub API: {exc.reason}")


async def _api(path: str, *, method: str = "GET", payload: dict | None = None,
               timeout: int = 60):
    """Call the GitHub REST API. urllib blocks, so it runs off the event loop.

    Reading a PR's feedback is several round trips, and blocking here would stall
    every other run in this container for the duration.
    """
    return await asyncio.to_thread(
        _api_sync, path, method=method, payload=payload, timeout=timeout
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
    # The tip before any of the agent's work — the only reliable way to list what
    # this run added, since a shallow clone has no other history to diff against.
    base_sha = await _git("rev-parse", "HEAD", cwd=dest)
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
    return {"repo": repo, "path": str(dest), "branch": branch, "default_branch": default,
            "base_sha": base_sha}


async def resume_branch(repo: str, branch: str) -> dict:
    """Check out an existing branch, to continue work already pushed to it.

    The counterpart to prepare_repo: same clean-clone discipline, but onto a
    branch that already has commits instead of a fresh one. Used when revising a
    pull request, where starting a new branch would abandon the review thread.

    Any non-protected branch is allowed, not just ones this agent created — the
    point of the feature is to act on a PR you point it at, and refusing your own
    branches would make it half useless. Protected branches are refused here as
    everywhere else, and nothing in this module can force-push or rewrite history,
    so the worst case is an extra commit on a branch that is already under review.
    """
    if not REPO_RE.match(repo or ""):
        raise WorkspaceError(f"Expected a repository as 'owner/name', got '{repo}'.")
    _check_ref(branch)

    dest = repo_dir(repo)
    url = f"https://github.com/{repo}.git"

    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)
    dest.parent.mkdir(parents=True, exist_ok=True)

    # --branch checks out the remote branch directly; --depth 1 keeps only its
    # tip, which is all that is needed to add commits on top.
    await _git("clone", "--depth", "1", "--branch", branch, url, str(dest))

    checked_out = await _git("rev-parse", "--abbrev-ref", "HEAD", cwd=dest)
    if checked_out != branch:
        raise WorkspaceError(f"Expected to be on '{branch}' after clone, got '{checked_out}'.")
    _check_branch(checked_out)

    _grant_sandbox_access(dest)
    log.info("Resumed %s on existing branch %s", repo, branch)
    return {"repo": repo, "path": str(dest), "branch": branch}


async def fetch_pr(repo: str, number: int) -> dict:
    """Look up a pull request, and refuse the ones that cannot be worked on."""
    if not REPO_RE.match(repo or ""):
        raise WorkspaceError(f"Expected a repository as 'owner/name', got '{repo}'.")
    try:
        data = await _api(f"/repos/{repo}/pulls/{int(number)}")
    except GitHubApiError as exc:
        if exc.status == 404:
            raise WorkspaceError(f"No pull request #{number} on {repo}.")
        raise

    head, base = data.get("head") or {}, data.get("base") or {}
    head_repo = (head.get("repo") or {}).get("full_name")

    if data.get("state") != "open":
        state = "merged" if data.get("merged") else data.get("state")
        raise WorkspaceError(
            f"Pull request #{number} is {state} — reopen it, or start a new task."
        )
    if head_repo != repo:
        # A fork's branch lives in another repository the PAT has no write access
        # to, so a push would fail after the work was already done.
        raise WorkspaceError(
            f"Pull request #{number} comes from a fork ({head_repo}). "
            f"The agent can only revise branches in {repo} itself."
        )

    return {
        "number": data.get("number"),
        "url": data.get("html_url"),
        "title": data.get("title") or "",
        "body": data.get("body") or "",
        "branch": head.get("ref"),
        "base": base.get("ref"),
        "draft": bool(data.get("draft")),
    }


def _comment(kind: str, item: dict) -> dict | None:
    body = (item.get("body") or "").strip()
    if not body or AGENT_COMMENT_MARKER in body:
        return None  # our own progress note, not feedback
    return {
        "kind": kind,
        "author": (item.get("user") or {}).get("login") or "unknown",
        "created_at": item.get("created_at") or "",
        "body": body,
        "path": item.get("path"),
        "line": item.get("line") or item.get("original_line"),
        "hunk": item.get("diff_hunk"),
    }


async def fetch_pr_feedback(repo: str, number: int) -> list[dict]:
    """Every human comment on a PR: reviews, inline notes and thread replies.

    Ordered oldest first so the agent reads the conversation the way a person
    would. Comments this module posted are filtered out by marker — the PAT acts
    as the user, so the author login cannot tell them apart.
    """
    n = int(number)
    reviews, inline, thread = await asyncio.gather(
        _api(f"/repos/{repo}/pulls/{n}/reviews?per_page=100"),
        _api(f"/repos/{repo}/pulls/{n}/comments?per_page=100"),
        _api(f"/repos/{repo}/issues/{n}/comments?per_page=100"),
    )

    items: list[dict] = []
    for review in reviews or []:
        entry = _comment("review", review)
        if entry:
            entry["state"] = review.get("state")
            entry["created_at"] = review.get("submitted_at") or ""
            items.append(entry)
    for source, kind in ((inline, "inline"), (thread, "comment")):
        for raw in source or []:
            entry = _comment(kind, raw)
            if entry:
                items.append(entry)

    items.sort(key=lambda c: c["created_at"])
    return items


async def comment_on_pr(repo: str, number: int, body: str) -> None:
    """Post a progress note on a PR. Best effort — never fails the run."""
    try:
        await _api(
            f"/repos/{repo}/issues/{int(number)}/comments",
            method="POST",
            payload={"body": f"{body[:60000]}\n\n{AGENT_COMMENT_MARKER}"},
        )
    except WorkspaceError:
        log.warning("Could not comment on %s#%s", repo, number, exc_info=True)


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

    # Scratch space for layout harnesses and other throwaway rigs. Excluded from
    # both the change check and the commit, because `git add -A` would otherwise
    # sweep a temporary harness into the pull request — and an agent that has to
    # remember to delete something will eventually forget.
    scratch = f":(exclude){SCRATCH_DIR}"

    status = await _git("status", "--porcelain", "--", ".", scratch, cwd=dest)
    if not status.strip():
        return {"committed": False, "branch": branch, "detail": "No changes to commit."}

    await _git("add", "-A", "--", ".", scratch, cwd=dest)
    await _git("commit", "-m", message or "Work in progress", cwd=dest)
    await _git("push", "origin", branch, cwd=dest)

    sha = await _git("rev-parse", "--short", "HEAD", cwd=dest)
    files = len([l for l in status.splitlines() if l.strip()])
    log.info("Pushed %s to %s (%d files)", sha, branch, files)
    return {"committed": True, "branch": branch, "sha": sha, "files_changed": files}


async def commit_subjects(repo: str, since_sha: str) -> list[str]:
    """Subject lines of the commits this run added, oldest first."""
    dest = repo_dir(repo)
    if not dest.exists() or not since_sha:
        return []
    try:
        out = await _git("log", "--reverse", "--pretty=%s", f"{since_sha}..HEAD", cwd=dest)
    except WorkspaceError:
        return []
    return [line.strip() for line in out.splitlines() if line.strip()]


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

    try:
        data = await _api(f"/repos/{repo}/pulls", method="POST", payload={
            "title": title[:250] or f"Atlas: {branch}",
            "head": branch,
            "base": base,
            "body": body[:60000],
            # A draft PR cannot be merged until a human marks it ready, which
            # makes accidental automation one step further away from main.
            "draft": True,
        })
        return {"url": data.get("html_url"), "number": data.get("number"), "draft": True}
    except GitHubApiError as exc:
        if exc.status == 422 and "already exists" in exc.detail:
            # Re-running against the same branch is normal; find the open PR.
            existing = await _find_open_pr(repo, branch)
            if existing:
                return existing
        raise WorkspaceError(f"Could not open a pull request ({exc.status}): {exc.detail}")


async def _find_open_pr(repo: str, branch: str) -> dict | None:
    owner = repo.split("/")[0]
    try:
        items = await _api(f"/repos/{repo}/pulls?head={owner}:{branch}&state=open", timeout=30)
        if items:
            return {"url": items[0].get("html_url"), "number": items[0].get("number"),
                    "draft": items[0].get("draft", False)}
    except WorkspaceError:
        log.debug("Could not look up existing PR", exc_info=True)
    return None
