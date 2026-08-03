"""
Connection to the sandbox container.

Strands' SshSandbox does the work: it builds the ssh argv, streams output, and
`get_tools()` returns ready-made bash and file-editor tools that plug straight
into an Agent. Nothing here reimplements any of that — this module only decides
*how* to connect and proves the isolation holds.

Host key handling: the default (`allow_unknown_hosts=False`) is
StrictHostKeyChecking=accept-new — trusted on first connect, refused if it ever
changes. That is the right posture here because the sandbox's host keys live in
their own volume, so they survive image rebuilds; a key that changes underneath
us means something replaced the container, which is worth failing on.
"""
import asyncio
import logging
import os

# Note: SshSandbox is not re-exported from strands.sandbox's __init__, only
# PosixShellSandbox is. It has to be imported from the submodule.
from strands.sandbox.ssh import SshSandbox

log = logging.getLogger("atlas.agent.sandbox")

SANDBOX_HOST = os.getenv("SANDBOX_HOST", "coder@sandbox")
SANDBOX_KEY = os.getenv("SANDBOX_IDENTITY_FILE", "/etc/sandbox/id_ed25519")
SANDBOX_WORKDIR = os.getenv("WORKSPACE_DIR", "/workspace")


def build_sandbox(working_dir: str | None = None) -> SshSandbox:
    """A sandbox rooted at a repo checkout, or at the workspace itself."""
    return SshSandbox(
        SANDBOX_HOST,
        working_dir=working_dir or SANDBOX_WORKDIR,
        identity_file=SANDBOX_KEY,
    )


async def check() -> dict:
    """Verify the sandbox is reachable and, more importantly, properly caged.

    The second half is the point. The sandbox is meant to have no route to the
    dashboard API, and that guarantee comes from Docker network placement — the
    kind of thing that breaks silently during an unrelated compose edit. So it
    is asserted at runtime rather than assumed.
    """
    sandbox = build_sandbox()
    out: dict = {"reachable": False, "isolated": None}

    try:
        result = await asyncio.wait_for(
            sandbox.execute("whoami && pwd && git --version && node --version"),
            timeout=30,
        )
        out["reachable"] = result.exit_code == 0
        out["detail"] = (result.stdout or result.stderr or "").strip()[:300]
    except Exception as exc:
        out["detail"] = f"{type(exc).__name__}: {exc}"[:300]
        return out

    try:
        # Expect failure. A success here means the sandbox can reach the API and
        # the credential separation is worthless.
        probe = await asyncio.wait_for(
            sandbox.execute("curl -s -m 5 -o /dev/null -w '%{http_code}' http://api:8000/health"),
            timeout=20,
        )
        code = (probe.stdout or "").strip()
        out["isolated"] = code in ("", "000")
        out["api_probe"] = code or "unreachable"
    except Exception:
        out["isolated"] = True
        out["api_probe"] = "unreachable"

    if out["isolated"] is False:
        log.error("Sandbox can reach the API — network isolation is broken.")
    return out
