# Atlas infrastructure runbook

Everything needed to rebuild the deployment from nothing — a new droplet, a
different provider, or a resize that forces a snapshot rebuild. Written as steps
to execute, with the reasoning kept to one line where the reasoning matters.

Current host: DigitalOcean, `209.38.169.188` (reserved IP), 2 GB / 1 vCPU / 48 GB.
Repo on host: **`/root/atlas`** (not `~/personal-os`).

---

## 1. Host prerequisites

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Caddy — runs as a systemd service on the HOST, not in compose
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

### Swap (do this before anything else)

No swap means a memory spike kills a container outright, and the OOM killer
picks by score — it may take `api` rather than whoever caused the spike.

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.conf
```

`swappiness=10` so swap is a safety net under real pressure, not a thing the
kernel reaches for to grow page cache.

---

## 2. DNS and TLS

DuckDNS subdomain `willwoodward-clan-manager` → the reserved IP.

**On a provider move, reassign the reserved IP rather than changing DNS** — no
propagation wait, and Caddy's stored certificate stays valid.

`/etc/caddy/Caddyfile`:

```
willwoodward-clan-manager.duckdns.org {
    reverse_proxy localhost:8000
}
```

`systemctl reload caddy`. Certificates issue automatically on first request.

---

## 3. Secrets

### `/root/atlas/.env.production` — never committed

```
ALLOWED_EMAILS=will@woodwardweb.com
ALLOWED_ORIGINS=https://<username>.github.io
GOOGLE_CLIENT_ID=...
JWT_SECRET=<64 random chars>
ATLAS_MCP_KEY=<32 random chars>
DATABASE_PATH=/data/atlas.db
OPENAI_API_KEY=sk-proj-...
TAVILY_API_KEY=tvly-dev-...
GITHUB_PAT=github_pat_...        # fine-grained, see below
```

Changing this file requires **`docker compose up -d --force-recreate`** — a
`restart` does *not* re-read `env_file`. This has bitten us twice.

### GitHub PAT scope

Fine-grained, restricted to the repos the agent may touch:

| Permission | Setting | Why |
|---|---|---|
| Contents | Read and write | clone, push branches |
| Pull requests | Read and write | open PRs, read review comments, post progress notes |
| **Workflows** | **Do not grant** | a merged agent-authored workflow can read repo secrets |

A PR revision run posts two comments in the PR thread. Those go through the
*issue* comments endpoint, which for a pull request is covered by Pull requests:
write — no Issues permission is needed. Commenting is best effort: a 403 there
logs a warning and never fails the run, so the symptom of a wrong scope is
silence in the thread, not a broken run.

Withholding Workflows makes a workflow-modifying push *fail at the API* rather
than relying on the agent to behave. Prefer removing a capability to gating it.

### Agent → sandbox SSH keypair

```bash
mkdir -p /root/atlas/secrets && chmod 700 /root/atlas/secrets
ssh-keygen -t ed25519 -N "" -C "atlas-agent->sandbox" \
  -f /root/atlas/secrets/sandbox_key
chmod 600 /root/atlas/secrets/sandbox_key
```

Host-specific, gitignored, regenerate per host. Private key mounts read-only
into `agent`; public key into `sandbox`.

---

## 4. Bring it up

```bash
cd /root/atlas
docker compose up -d --build
```

Services: `api` (FastAPI + SQLite + MCP), `agent` (Strands runtime),
`sandbox` (coding execution). Caddy is on the host, not here.

---

## 5. Security properties — verify after any change

These are the invariants. Each is enforced structurally; each has broken or
nearly broken during unrelated edits, so re-check them after touching compose.

**API is loopback-only.** `docker-compose.yml` binds `127.0.0.1:8000:8000`, not
`8000:8000`. Caddy reaches it on localhost; nothing else can. This also closes
the Docker gateway route (`172.17.0.1:8000`) that would otherwise let the
sandbox reach the dashboard API.

```bash
ss -tlnp | grep :8000                        # want 127.0.0.1:8000
curl -m 5 http://<public-ip>:8000/health     # want connection refused
curl https://<domain>/health                 # want 200
```

**Sandbox has no route to the API.** It sits on `sandbox_net` only; `api` is on
`default` only. `agent` bridges both.

```bash
docker compose exec sandbox sh -c 'getent hosts api || echo "no DNS - good"'
docker compose exec sandbox sh -c \
  'curl -s -m 5 -o /dev/null -w "%{http_code}\n" http://api:8000/health'   # want 000
docker compose exec sandbox sh -c \
  'curl -s -m 10 -o /dev/null -w "%{http_code}\n" https://registry.npmjs.org/'  # want 200
```

Egress to the internet is intentional — npm and pip need it.

**Sandbox holds no credentials.** No `env_file`. It never contacts a git remote:
`agent` clones into the shared `workspace` volume and pushes from its side, so
the PAT never lands in `.git/config` where executed code could read it.

**Agent publishes no ports.** Only route in is `api`'s `/assistant` proxy behind
the Google-OAuth JWT, which the agent re-validates against `ALLOWED_EMAILS`.

**Sandbox runs unprivileged.** User `coder`, no sudo, key-auth-only sshd, capped
at `mem_limit: 1g` / `pids_limit: 512` so a runaway build dies alone.

**Nothing reaches main without a human.** Four independent layers, because the
PAT itself *is* capable of merging — merging a PR needs only `contents: write`,
so the guarantee cannot come from token scope:

1. `workspace.py` has no merge call, no force-push, no branch delete, no rebase.
2. `PROTECTED_BRANCHES` is checked in `prepare_repo`, `resume_branch`,
   `commit_and_push` and `open_pull_request` — four separate points, all
   case-insensitive.
3. PRs open as **drafts**, which GitHub refuses to merge until marked ready.
4. A **branch protection ruleset on the remote** (below) — the only layer that
   still holds if the agent is compromised or the code is changed.

Layer 4 must be set up by hand: the PAT has no Administration permission, so
neither the agent nor this tooling can create *or weaken* it.

### Branch protection ruleset (do this once per repo)

Repo → **Settings** → **Rules** → **Rulesets** → **New branch ruleset**

- Name: `protect-main`, Enforcement status: **Active**
- Target branches: **Include default branch**
- Rules to enable:
  - **Require a pull request before merging** → Required approvals: **0**
  - **Block force pushes**
  - **Restrict deletions**

Zero approvals, not one. The PAT acts as *you*, so the agent's pull requests are
authored by you — and GitHub does not let you approve your own pull request. Set
it to 1 and every agent PR becomes unmergeable. The protection that matters here
is "no direct push to main", which 0 approvals still gives you in full.

With this on, a direct push to `main` is rejected by the server regardless of
what any client does.

Verify:

```bash
# expect: 403, "protected branch hook declined"
git push origin HEAD:main --dry-run
```

> Note: `docker compose exec sandbox` lands you in as **root** — that is `exec`
> defaulting to root, not the SSH login path. The agent arrives over SSH as
> `coder`. Check with `ssh ... whoami`, not `docker exec ... id`.

---

## 6. Gotchas that have cost time

- **`env_file` is read at container creation only.** `restart` won't pick up a
  changed `.env.production`; use `up -d --force-recreate`.
- **`useradd` leaves the account locked.** With `UsePAM no`, sshd refuses a
  locked account even for key auth — hence `usermod -p '*' coder` in the sandbox
  Dockerfile. Symptom: `User coder not allowed because account is locked`.
- **Sandbox host keys live in the `sandbox_hostkeys` volume.** Otherwise every
  image rebuild presents a new identity and the agent's
  `StrictHostKeyChecking=accept-new` correctly refuses to reconnect. If you
  deliberately recreate the sandbox from scratch, clear the agent's known_hosts.
- **A resize that grows the disk is permanent.** DigitalOcean only offers the
  reversible CPU/RAM-only resize when disk size is unchanged. The way back down
  is snapshot → destroy → recreate smaller → reassign the reserved IP.
- **Set `mem_limit` per service.** Without it any container can consume all host
  RAM and the OOM killer may pick the wrong victim.

### Layout checking in the sandbox

The sandbox image carries Chromium (via Playwright) and a `render-probe` CLI so
the coding agent can check *where things landed* rather than inferring it from a
diff. It reports geometry as JSON — positions, sizes, overlaps, horizontal
overflow — so a text-only model can assert against numbers instead of looking at
a picture. This exists because a build passing, tests passing and the JSX parsing
all said "fine" about a change that moved an avatar to the wrong side of a header.

- **Default is `INSTALL_BROWSER=0` — off.** Enable with
  `--build-arg INSTALL_BROWSER=1`. With it off, `render-probe` exits 3 with an
  explanation instead of a module-resolution stack trace.
- Chromium is **on disk, never resident**. It only starts when the agent invokes
  `render-probe`, so a backend task costs nothing at runtime. The prompt gates it
  to changes in how a page looks.
- Measured cost: the sandbox image goes **977MB → 2.47GB** (+1.49GB; 656MB is
  the browser, the rest is the GTK/font stack `playwright install --with-deps`
  pulls in), plus ~520MB peak RSS during a probe run against `mem_limit: 1g` on
  a 2GB host. It fits, but it leans on swap.
- **Selectors must be structural.** The app styles with inline objects, so there
  are almost no classes to target. What works:
  `#root > div > div:first-child > div:last-child` for the mobile avatar. The
  probe exits 1 and names anything it could not find, so a wrong selector fails
  loudly rather than silently measuring nothing.
- **Only turn it on once the probe can measure the real app.** Run the frontend
  dev server in the sandbox with `VITE_MOCK_AUTH=1` and point the probe at it
  (`--url http://localhost:5173`). Against a harness the agent wrote itself the
  probe measures a reconstruction of the code it is already misunderstanding,
  and reports "layout verified" about a fiction — worse than no check at all.
- Harnesses go in `.atlas-scratch/` inside the clone. `commit_and_push` excludes
  that path from both the change check and `git add -A`, so a throwaway rig can
  never end up in the pull request. Covered by `TestScratchDirectory`.

---

## 7. CI/CD

- `.github/workflows/deploy-frontend.yml` — push to `main` → GitHub Pages.
- `.github/workflows/deploy-backend.yml` — push to `backend/**` → SSH → `git pull`
  → `docker compose up -d --build`.

Secrets: `VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID`, `DO_HOST`, `DO_SSH_KEY`, `DO_USER`.

The deploy does `git pull`, so **the working tree on the droplet must stay
clean** — a locally-modified tracked file makes the pull fail and the deploy
silently keeps running old code.

---

## 8. Tests

Run against the dev stack. The images ship runtime deps only, so the test deps
are installed into the running container — they do not survive a recreate.

```bash
cd frontend && npm install && npm test          # vitest — reduceMessage reducer

C=docker compose -f docker-compose.dev.yml
$C exec api   sh -c "pip install -q -r requirements-dev.txt && cd /app && python -m pytest -q"
$C exec agent sh -c "pip install -q -r requirements-dev.txt && cd /app && python -m pytest -q"
```

Currently 34 frontend / 21 api / 88 agent. The agent suite covers the workspace
guards (protected branches, ref validation, repo-name validation, PAT redaction,
scratch-dir exclusion), the PR revision path, and the question/answer plumbing;
the api suite covers the durable-run state machine and the auth boundary between
the session JWT and the MCP key.

---

## 9. Backup

The only irreplaceable state is SQLite in the `sqlite_data` volume.

```bash
docker compose exec -T api sqlite3 /data/atlas.db ".backup '/data/backup.db'"
docker compose cp api:/data/backup.db ./atlas-backup-$(date +%F).db
```

`workspace` is disposable — clones are re-cloned. `sandbox_hostkeys` is
disposable but clearing it forces a known_hosts reset on the agent.
