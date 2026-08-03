"""
Coding delegation — the orchestrator hands a feature to an agent with a sandbox.

Mirrors research.py in shape: delegation is a tool, so the orchestrator decides
at runtime what work to hand off rather than choosing from a fixed roster. The
differences are all consequences of code being stateful where research is not.

Sequential, not concurrent. Two coding agents on 1 vCPU sharing one workspace
would thrash and could edit the same tree. `_slot` enforces one at a time.

The split that matters: this module and workspace.py run in the agent container
and own every git operation; the sandbox container owns the filesystem and the
build. The sandbox has no credentials and no route to the dashboard API, so the
worst a bad generated command can do is corrupt a throwaway clone.

Nothing here can merge. There is no merge call in workspace.py, PRs are opened
as drafts, and main is refused at three separate points. Reaching main requires
a human pressing the button on GitHub.
"""
import asyncio
import logging
import os

from strands import Agent, tool
from strands.agent.conversation_manager import (
    ProactiveCompressionConfig,
    SlidingWindowConversationManager,
)
from strands.models.openai_responses import OpenAIResponsesModel

import workspace
from progress import emit as _emit
from questions import ask_user
from sandbox_client import build_sandbox
from tool_trace import ToolTracer, summarise_args

log = logging.getLogger("atlas.agent.coding")

CODING_TIMEOUT = int(os.getenv("CODING_TIMEOUT", "1800"))  # 30 min, whole task
CONTEXT_WINDOW_MESSAGES = 40   # source files are large; fewer turns fit than in research
COMPRESSION_THRESHOLD = 0.6
MAX_SUMMARY_CHARS = 6000

# One at a time. See module docstring.
_slot = asyncio.Semaphore(1)

CODER_PROMPT = """You are a software engineer working in an isolated sandbox on \
a checkout of {repo}, on branch `{branch}`.

Your task:
{task}

{context}

The environment:
- You are in {path} on a Linux box with git, node 22, python3, ripgrep and jq.
- Use bash and the file editor to explore, change, build and test.
- You have internet access, so dependencies can be installed.
- You CANNOT reach the user's dashboard API or any of their data. Don't try.

How to work:
- Read before you write. Understand the existing conventions — naming, structure, \
error handling, test style — and match them. Code that looks foreign to the \
codebase is a defect even when it works.
- Make the smallest change that accomplishes the task. Do not refactor \
surrounding code, reformat files, or fix unrelated problems you notice. Mention \
them in your summary instead.
- Run the tests. If the project has a test command, use it. If your change is \
testable and the project has tests, add one.
- Verify your work actually runs. A change you have not executed is a guess.

Verification is not optional. Before your final commit you MUST check that every \
file you changed still parses. Try in this order and use the first that works:
1. The project's own build or test command. If dependencies are missing, install \
them — you have internet access and time. `npm ci` or `npm install` in the right \
directory is expected, not a last resort.
2. If a full build is genuinely impractical, syntax-check the changed files \
directly. For JS/JSX: `npx --yes esbuild <file> --loader:.jsx=jsx --outfile=/dev/null`. \
For Python: `python3 -m py_compile <file>`.

A file that does not parse is not a partial success, it is a broken change, and \
committing one wastes the reviewer's time entirely. If you could not run any \
check at all, say so explicitly and say which files are unverified — never let \
"I could not verify" quietly become "it works".

Git — read this carefully, it is not what you are used to:
- The branch `{branch}` has ALREADY been created for you and already exists on \
the remote. Do not create it, switch to it, or switch away from it. You are on \
it now and you stay on it.
- You have NO git credentials and no network access to the remote. `git push`, \
`gh`, and anything similar will fail. Do not attempt them.
- `commit_work` is the only way to save your work. It commits everything in the \
tree and pushes it for you. Call it after each meaningful step, not once at the \
end — if your run is cut short, whatever you committed survives and whatever you \
did not is lost.
- Commit messages: imperative mood, one line, say what changed and why.
- A pull request is opened for you automatically when you finish. You do not \
need to open one, and you cannot. It is created as a draft; the user reviews and \
merges it themselves. Do not tell them it is merged or ready to merge.
- Read-only git is fine and encouraged: `git status`, `git diff`, `git log` are \
useful for checking your own work.

Boundaries you must not cross:
- Never work on or push to main. You are on `{branch}` and it stays that way. \
If you check out another branch, `commit_work` will refuse and your work will \
not be saved.
- Never modify files under .github/workflows. The push will be rejected anyway.
- Never rewrite history, force-push, or delete branches.
- Never commit secrets, tokens, or credentials.

If you get genuinely stuck on a decision only the user can make — an ambiguous \
requirement, two reasonable approaches with different trade-offs, a missing \
detail you would otherwise invent — call `ask_user`. Your run pauses with your \
context and working tree intact and resumes with their answer, so asking costs \
you nothing. Do not use it to ask permission for work you were already given, or \
to check finished work. Ask at most a couple of times in a run; if you are \
asking constantly the task was underspecified and say so in your summary instead.

Finish with a summary for the user:
- What you changed, file by file, and why.
- What you tested, and the actual result — say plainly if you could not run tests.
- Anything you could not finish, got wrong, or are unsure about.
- Problems you noticed but deliberately left alone.

Be honest about failure. A summary claiming success for work that does not run \
is far worse than one saying you got stuck — the user will read the code either \
way, and an inflated claim costs them the time they spent trusting it."""


def _coder_model() -> OpenAIResponsesModel:
    client_args = {"api_key": os.environ["OPENAI_API_KEY"]}
    if os.getenv("OPENAI_BASE_URL"):
        client_args["base_url"] = os.environ["OPENAI_BASE_URL"]
    return OpenAIResponsesModel(
        client_args=client_args,
        model_id=os.getenv("AGENT_MODEL_ID", "gpt-5.6-luna"),
        params={"max_output_tokens": int(os.getenv("CODING_MAX_TOKENS", "16384"))},
    )


def _commit_tool(repo: str):
    """A commit tool bound to one repo, so the agent cannot commit elsewhere."""

    @tool(name="commit_work")
    async def commit_work(message: str) -> dict:
        """Commit everything you have changed and push it to your branch.

        Call this after each meaningful step. Work that is not committed is lost
        if the run ends early.

        Args:
            message: One-line commit message, imperative mood.
        """
        try:
            result = await workspace.commit_and_push(repo, message)
            _emit({
                "type": "coding_commit",
                "sha": result.get("sha"),
                "message": message,
                "files": result.get("files_changed", 0),
                "committed": result.get("committed", False),
            })
            return result
        except workspace.WorkspaceError as exc:
            # Surface the failure. A commit that silently does nothing looks to
            # the user like an agent that never tried, and the run continues
            # believing its work is saved when it is not.
            _emit({
                "type": "coding_commit", "committed": False,
                "message": message, "error": str(exc)[:300],
            })
            return {"error": str(exc)}

    return commit_work


def _tracer() -> ToolTracer:
    return ToolTracer(
        emit=_emit,
        build=lambda *, tool_use_id, name, args, status, output: {
            "type": "coding_activity",
            "tool": name,
            "detail": summarise_args(args),
            "status": status,
        },
    )


@tool
async def delegate_coding(repo: str, task: str, context: str = "") -> dict:
    """Hand a coding task to an engineer agent working in an isolated sandbox.

    Use this for anything that means changing code: implementing a feature,
    fixing a bug, adding tests, updating docs in a repository. The agent clones
    the repo, works on its own branch, commits as it goes, and opens a draft
    pull request. It cannot merge — you review and merge on GitHub yourself.

    One task at a time; a second call waits for the first to finish. Give a
    self-contained instruction: the agent cannot see this conversation.

    Args:
        repo: Repository as "owner/name", e.g. "willwoodward/atlas".
        task: What to build or fix, stated fully. Include the acceptance
            criteria — what "done" looks like.
        context: Background that helps: relevant files, constraints, prior
            decisions, how to run the tests.

    Returns:
        The branch, the draft PR url, what the agent did, and what it could not
        do. Always report the PR link and any failures to the user verbatim.
    """
    if not (repo or "").strip() or not (task or "").strip():
        return {"error": "Both a repository and a task description are required."}

    async with _slot:
        try:
            prepared = await workspace.prepare_repo(repo, task)
        except workspace.WorkspaceError as exc:
            return {"error": str(exc), "stage": "clone"}

        branch, path, base = prepared["branch"], prepared["path"], prepared["default_branch"]
        _emit({"type": "coding_started", "repo": repo, "branch": branch, "task": task[:300]})
        log.info("Coding on %s branch %s", repo, branch)

        sandbox = build_sandbox(working_dir=path)
        agent = Agent(
            model=_coder_model(),
            system_prompt=CODER_PROMPT.format(
                repo=repo, branch=branch, path=path, task=task,
                context=f"Context you were given:\n{context}" if context else "",
            ),
            tools=[*sandbox.get_tools(), _commit_tool(repo), ask_user],
            conversation_manager=SlidingWindowConversationManager(
                window_size=CONTEXT_WINDOW_MESSAGES,
                should_truncate_results=True,
                proactive_compression=ProactiveCompressionConfig(
                    compression_threshold=COMPRESSION_THRESHOLD,
                ),
            ),
            hooks=[_tracer()],
            callback_handler=None,
            name=f"coder-{branch}",
        )

        summary, status = "", "ok"
        try:
            result = await asyncio.wait_for(
                agent.invoke_async("Begin. Explore the codebase first, then make your change."),
                timeout=CODING_TIMEOUT,
            )
            summary = str(result)
        except asyncio.TimeoutError:
            status = "timeout"
            summary = f"The agent ran out of time after {CODING_TIMEOUT // 60} minutes."
            log.warning("Coding task timed out on %s", branch)
        except Exception as exc:
            status = "error"
            summary = f"{type(exc).__name__}: {exc}"[:500]
            log.exception("Coding task failed on %s", branch)

        # Sweep up anything the agent changed but never committed — a timeout or
        # crash usually leaves real work sitting uncommitted in the tree.
        try:
            final = await workspace.commit_and_push(repo, "Work in progress (agent run ended)")
            if final.get("committed"):
                _emit({"type": "coding_commit", "sha": final.get("sha"),
                       "message": "uncommitted work swept up", "files": final.get("files_changed", 0),
                       "committed": True})
        except workspace.WorkspaceError:
            log.warning("Could not sweep up uncommitted work", exc_info=True)

        diff = ""
        try:
            diff = await workspace.diff_summary(repo)
        except workspace.WorkspaceError:
            pass

        pr: dict = {}
        pr_error = None
        try:
            pr = await workspace.open_pull_request(
                repo, branch,
                title=task.strip().splitlines()[0][:120],
                body=(f"{summary[:50000]}\n\n---\n*Opened by Atlas. "
                      f"Draft — review and merge yourself.*"),
                base=base,
            )
        except workspace.WorkspaceError as exc:
            pr_error = str(exc)
            log.warning("Could not open PR for %s: %s", branch, pr_error)

        _emit({"type": "coding_done", "status": status, "branch": branch,
               "pr_url": pr.get("url"), "summary": summary[:MAX_SUMMARY_CHARS]})

        return {
            "repo": repo,
            "branch": branch,
            "status": status,
            "pull_request": pr.get("url") or f"not opened: {pr_error}",
            "draft": True,
            "changed_files": diff,
            "summary": summary[:MAX_SUMMARY_CHARS],
            "next_step": (
                "The user can already see the full summary, the commit list and the "
                "pull request link in their interface — do NOT repeat them. Reply in "
                "at most two sentences: what was done, and anything they must know. "
                "Do not list the changed files, do not restate the checks, do not "
                "paste the PR link.\n\n"
                "The exceptions, which you must always state: if status is not 'ok', "
                "say plainly what failed and what was left half-done (the work is "
                "still committed on the branch). If the agent reported that it could "
                "not verify its work, say so in your own words — the user needs to "
                "know a diff is unchecked before they read it."
            ),
        }
