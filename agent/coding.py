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

A run is either new work or a revision of an open PR. A revision checks out that
PR's branch instead of cutting a new one and is fed the review comments, so
feedback lands on the same pull request rather than opening a second one next to
it. A revision never changes the PR's draft/ready state — that flag is the user's
signal, not ours.
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
MAX_FEEDBACK_CHARS = 20000  # a long review thread must not crowd out the code

# One at a time. See module docstring.
_slot = asyncio.Semaphore(1)

CODER_PROMPT = """You are a software engineer working in an isolated sandbox on \
a checkout of {repo}, on branch `{branch}`.

Your task:
{task}

{mode_note}

{context}

The environment:
- You are in {path} on a Linux box with git, node 22, python3, ripgrep and jq.
- Use bash and the file editor to explore, change, build and test.
- When viewing a file, omit `view_range` unless you already know how long the \
file is. The range is validated, not clamped: asking for lines past the end of \
the file is an error and you will have to read it again. To read from a point to \
the end, use -1 as the second element.
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
- Run build and test commands from the directory that contains the manifest \
(package.json, pyproject.toml, Cargo.toml), not from the repository root. In a \
repo with several sub-projects the root usually has no manifest at all, and \
running there fails for a reason that has nothing to do with your change.
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

Checking layout — ONLY for changes to how a page looks. Skip this entirely for \
backend, CLI, config or logic work; starting a browser for those is wasted time.

A build passing tells you a file parses, not that an element ended up where you \
meant it to. If you moved, positioned, sized or removed something visual, prove \
it with `render-probe`, measuring the REAL app:

  VITE_MOCK_AUTH=1 npm run dev &        # from frontend/, then wait for the port
  render-probe --url http://localhost:5173 --width 390 \
      --measure ".topbar,.burger,.label,.avatar"

`VITE_MOCK_AUTH=1` signs you in as a fixed user and stubs the API, which is what \
makes the dashboard reachable — this sandbox has no route to the backend, so \
without it every page renders the login screen. It is a dev-only flag and is \
stripped from production builds.

It prints JSON: x/y/width/height/right/centerX per selector, plus any overlaps \
between them, whether the page scrolls sideways, and console errors. Assert \
against the numbers — "avatar.right is 370 and the header is 390 wide with 20px \
padding, so it is flush right" — rather than assuming.

This codebase styles with inline objects, so there are almost no CSS classes to \
select on. Use structural selectors instead — \
`#root > div > div:first-child > div:last-child` is how you reach the avatar in \
the mobile top bar. Anything the probe cannot find is named in a `warning` and \
exits non-zero, so check every selector reported `found: true` before you draw \
a conclusion from the numbers.

Overlaps are the check you did not have to think of. Two elements sitting on top \
of each other is the classic result of taking something out of the flex flow, \
and it will not show up in a diff or a build. A pair reported here that was not \
reported before your change is a regression.

Measure BEFORE you edit as well as after. A single set of numbers tells you \
where things are, not whether you moved something you did not intend to move. \
The comparison is the point: every element you did not mean to touch should have \
the same geometry in both runs, and any that shifted is a regression until you \
can say why it was supposed to.

Measure the running app, not a copy of it. Do NOT hand-write a static HTML \
harness that imitates the component: you would be reconstructing it from the \
same understanding that produced the change, so a mistake in the code gets \
faithfully reproduced in the harness and the probe reports that all is well. \
That is worse than not checking, because you will then say it was verified. If \
you do need somewhere to put a throwaway file, use `{scratch}/` at the \
repository root — it is never committed. Anything outside it WILL end up in the \
pull request.

If the probe cannot run — no browser in this sandbox, the dev server will not \
start, or the page cannot be reached — say so in your summary and name exactly \
what is visually unverified. Do not silently skip it and describe the change as \
checked.

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


REVISION_NOTE = """This is a REVISION of an existing pull request (#{number}), not \
a new piece of work. The branch already contains your earlier commits and the \
pull request is already open — do not open another one, and do not start over.

Read the review feedback below and address it, point by point. Do not make \
unrelated changes while you are in here: a revision that also refactors \
something else is much harder to re-review than the original.

Your summary MUST account for every comment individually. List each one — quote \
enough of it to be recognisable — and say exactly one of: what you changed for \
it, or why you disagree and left it. An inline comment on a specific line counts \
the same as a conversation comment; the small ones are the easiest to skim past \
and the most annoying to have to ask for twice. Never write a blanket line like \
"no comments remain unresolved" — the reviewer is reading your summary next to \
their own comments and will check."""


def _format_feedback(items: list[dict]) -> str:
    """Render PR feedback as the reviewer wrote it, oldest first."""
    if not items:
        return ("No review comments were found on the pull request. Ask the user "
                "what they want changed rather than guessing.")

    lines = ["Review feedback to address:", ""]
    for item in items:
        where = ""
        if item.get("path"):
            where = f" on `{item['path']}`" + (f" line {item['line']}" if item.get("line") else "")
        state = f" [{item['state']}]" if item.get("state") else ""
        lines.append(f"--- {item['author']}{where}{state}")
        # The hunk is what the comment is anchored to; without it an inline note
        # like "this is wrong" is unresolvable.
        if item.get("hunk"):
            lines.append("```diff")
            lines.append(item["hunk"][-1200:])
            lines.append("```")
        lines.append(item["body"][:4000])
        lines.append("")
    return "\n".join(lines)[:MAX_FEEDBACK_CHARS]


SWEEP_UP_MESSAGE = "Work in progress (agent run ended)"


def _pr_title(subjects: list[str], task: str) -> str:
    """Title the PR the way the engineer described the work, not the way it was asked.

    The task text is the orchestrator's restatement of a request — long, prefixed
    with "Update the application so that...", and truncating it mid-word makes a
    PR list unreadable. The first real commit subject is already a one-line
    imperative description of the change, which is exactly what a title wants.
    """
    for subject in subjects:
        if subject and subject != SWEEP_UP_MESSAGE:
            return subject[:120]

    # No commits, or only a sweep-up: fall back to the task, cut at a word.
    first = (task or "").strip().splitlines()[0] if (task or "").strip() else ""
    if len(first) <= 120:
        return first or "Atlas change"
    return first[:120].rsplit(" ", 1)[0].rstrip(" ,.;:-") + "…"


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
async def delegate_coding(repo: str, task: str, context: str = "", pr_number: int = 0) -> dict:
    """Hand a coding task to an engineer agent working in an isolated sandbox.

    Use this for anything that means changing code: implementing a feature,
    fixing a bug, adding tests, updating docs in a repository. The agent clones
    the repo, works on its own branch, commits as it goes, and opens a draft
    pull request. It cannot merge — you review and merge on GitHub yourself.

    Set pr_number to revise an open pull request instead of starting fresh: the
    agent checks out that PR's branch, reads the review comments on it, and
    pushes fixes to the same branch, so the review thread is kept. Use this
    whenever the user asks to change, fix or address feedback on an existing PR
    — starting a new run instead would abandon their review.

    One task at a time; a second call waits for the first to finish. Give a
    self-contained instruction: the agent cannot see this conversation.

    Args:
        repo: Repository as "owner/name", e.g. "willwoodward/atlas".
        task: What to build or fix, stated fully. Include the acceptance
            criteria — what "done" looks like. When revising, say what the user
            wants done about the feedback; the comments themselves are fetched.
        context: Background that helps: relevant files, constraints, prior
            decisions, how to run the tests.
        pr_number: Open pull request to revise. Omit to start new work.

    Returns:
        The branch, the draft PR url, what the agent did, and what it could not
        do. Always report the PR link and any failures to the user verbatim.
    """
    if not (repo or "").strip() or not (task or "").strip():
        return {"error": "Both a repository and a task description are required."}

    async with _slot:
        revising = bool(pr_number)
        pr: dict = {}
        mode_note, feedback_block = "", ""

        if revising:
            # Everything that makes a PR unworkable — closed, merged, on a fork —
            # is caught here, before a clone and a model run are spent on it.
            try:
                pr = await workspace.fetch_pr(repo, pr_number)
                feedback = await workspace.fetch_pr_feedback(repo, pr["number"])
                prepared = await workspace.resume_branch(repo, pr["branch"])
            except workspace.WorkspaceError as exc:
                return {"error": str(exc), "stage": "resume"}
            base = pr["base"]
            mode_note = REVISION_NOTE.format(number=pr["number"])
            feedback_block = _format_feedback(feedback)
        else:
            try:
                prepared = await workspace.prepare_repo(repo, task)
            except workspace.WorkspaceError as exc:
                return {"error": str(exc), "stage": "clone"}
            base = prepared["default_branch"]

        base_sha = prepared.get("base_sha", "")
        branch, path = prepared["branch"], prepared["path"]
        _emit({"type": "coding_started", "repo": repo, "branch": branch, "task": task[:300],
               "pr_url": pr.get("url"), "pr_number": pr.get("number"),
               "mode": "revision" if revising else "new"})
        log.info("Coding on %s branch %s (revising=%s)", repo, branch, revising)

        if revising:
            await workspace.comment_on_pr(
                repo, pr["number"],
                f"Atlas is revising this pull request: {task[:500]}",
            )

        sandbox = build_sandbox(working_dir=path)
        agent = Agent(
            model=_coder_model(),
            system_prompt=CODER_PROMPT.format(
                repo=repo, branch=branch, path=path, task=task,
                scratch=workspace.SCRATCH_DIR,
                mode_note=mode_note,
                context="\n\n".join(filter(None, [
                    f"Context you were given:\n{context}" if context else "",
                    feedback_block,
                ])),
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
            final = await workspace.commit_and_push(repo, SWEEP_UP_MESSAGE)
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

        pr_error = None
        if revising:
            # The PR already exists and the commits are already on its branch.
            # Report back in the thread, so the update is visible where the
            # review is happening rather than only in the chat window.
            # The draft state is left exactly as the user set it: marking a
            # ready PR back to draft would override their decision.
            await workspace.comment_on_pr(
                repo, pr["number"],
                f"**Atlas revision {'complete' if status == 'ok' else status}**\n\n"
                f"{summary[:20000]}",
            )
        else:
            try:
                subjects = await workspace.commit_subjects(repo, base_sha)
                pr = await workspace.open_pull_request(
                    repo, branch,
                    title=_pr_title(subjects, task),
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
            "mode": "revision" if revising else "new",
            "pull_request": pr.get("url") or f"not opened: {pr_error}",
            "draft": pr.get("draft", True),
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
                "know a diff is unchecked before they read it.\n\n"
                "If mode is 'revision', the changes went onto the existing pull "
                "request and a note was left in its thread. Its draft/ready state "
                "was not changed — do not tell the user it is ready to merge."
            ),
        }
