# Isolated execution environment for the coding agent.
#
# This container runs code the agent writes, so it is built on the assumption
# that everything inside it is untrusted. It holds no credentials: no PAT, no
# API keys, no JWT secret. Git remotes are never contacted from here — the agent
# container clones into the shared /workspace volume and pushes from its side,
# so a compromise in here yields source code and nothing else.
#
# Access is SSH with key auth only. Strands' SshSandbox drives it.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-server \
      git \
      ca-certificates \
      curl \
      python3 \
      python3-pip \
      python3-venv \
      build-essential \
      ripgrep \
      jq \
      less \
    && rm -rf /var/lib/apt/lists/*

# Node from nodesource — Debian's is too old to build most current projects.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Layout checking. Chromium is on disk but never runs unless the agent invokes
# `render-probe`, so a backend task costs nothing at runtime — this is disk, not
# RAM. Measured cost: the image goes from 977MB to 2.47GB (+1.49GB — 656MB of
# that is the browser itself, the rest is the GTK/font stack pulled in by
# `--with-deps`), plus roughly 520MB of RSS while a probe runs, against a 1g
# mem_limit on a 2GB host.
#
# Default OFF. The probe is only trustworthy when it measures the real app,
# which needs VITE_MOCK_AUTH (see docs/INFRA.md); pointed at a harness the agent
# wrote itself it can report "layout verified" about a fiction, which is worse
# than no check. Build with --build-arg INSTALL_BROWSER=1 to enable it.
ARG INSTALL_BROWSER=0
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers

COPY render-probe.mjs /opt/probe/render-probe.mjs
RUN set -e; \
    if [ "$INSTALL_BROWSER" = "1" ]; then \
      cd /opt/probe \
      && npm init -y > /dev/null \
      && npm install --no-audit --no-fund --silent 'playwright@^1.49' \
      && npx playwright install --with-deps chromium \
      && chmod -R a+rX /opt/playwright-browsers; \
    fi; \
    chmod +x /opt/probe/render-probe.mjs; \
    ln -sf /opt/probe/render-probe.mjs /usr/local/bin/render-probe; \
    rm -rf /var/lib/apt/lists/*

# Unprivileged user. The agent never gets root in here, so a runaway build
# cannot reconfigure sshd or install a persistent backdoor into the image.
#
# The `usermod -p '*'` matters: useradd leaves the account *locked* ("!" in
# /etc/shadow) and sshd with UsePAM=no refuses to authenticate a locked account
# even by key. "*" means "no password will ever match" — unlocked for key auth,
# still impossible to log into with a password.
RUN useradd --create-home --shell /bin/bash coder \
    && usermod -p '*' coder \
    && mkdir -p /home/coder/.ssh \
    && chmod 700 /home/coder/.ssh \
    && chown -R coder:coder /home/coder

# sshd needs this to exist at runtime.
RUN mkdir -p /run/sshd

# Key auth only, and only for `coder`. Password auth is off entirely so a weak
# or unset password can never become a way in.
RUN set -e; \
    printf '%s\n' \
      'PermitRootLogin no' \
      'PasswordAuthentication no' \
      'ChallengeResponseAuthentication no' \
      'KbdInteractiveAuthentication no' \
      'UsePAM no' \
      'PermitEmptyPasswords no' \
      'AllowUsers coder' \
      'X11Forwarding no' \
      'AllowTcpForwarding no' \
      'AllowAgentForwarding no' \
      'PrintMotd no' \
      'AuthorizedKeysFile /home/coder/.ssh/authorized_keys' \
      > /etc/ssh/sshd_config.d/atlas.conf

# Host keys are generated on first boot into a volume, so the agent's
# known_hosts entry stays valid across rebuilds of this image.
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
