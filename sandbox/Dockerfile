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
