#!/bin/bash
# Sandbox boot: install the agent's public key, persist host keys, run sshd.
set -euo pipefail

# The agent's public key: a mounted file by preference, env var as a fallback.
# Either way it stays out of the image and out of the build context.
KEY_FILE=/etc/sandbox/authorized_key.pub
if [ -s "$KEY_FILE" ]; then
  AUTHORIZED_KEY=$(cat "$KEY_FILE")
elif [ -n "${SANDBOX_AUTHORIZED_KEY:-}" ]; then
  AUTHORIZED_KEY=$SANDBOX_AUTHORIZED_KEY
else
  echo "No public key at $KEY_FILE and SANDBOX_AUTHORIZED_KEY unset — nothing could authenticate." >&2
  exit 1
fi

install -d -m 700 -o coder -g coder /home/coder/.ssh
printf '%s\n' "$AUTHORIZED_KEY" > /home/coder/.ssh/authorized_keys
chmod 600 /home/coder/.ssh/authorized_keys
chown coder:coder /home/coder/.ssh/authorized_keys

# Host keys live in a volume. Without this, every image rebuild would present a
# new host identity and the agent's strict host key check would (correctly)
# refuse to connect.
install -d -m 755 /etc/ssh/keys
if ! ls /etc/ssh/keys/ssh_host_*_key >/dev/null 2>&1; then
  ssh-keygen -A -f /tmp/hostkeys >/dev/null 2>&1 || true
  cp /tmp/hostkeys/etc/ssh/ssh_host_*_key* /etc/ssh/keys/ 2>/dev/null || ssh-keygen -q -t ed25519 -N '' -f /etc/ssh/keys/ssh_host_ed25519_key
fi
chmod 600 /etc/ssh/keys/ssh_host_*_key
printf '%s\n' 'HostKey /etc/ssh/keys/ssh_host_ed25519_key' >> /etc/ssh/sshd_config.d/atlas.conf

# Docker creates named volumes owned by root, and everything in here runs as
# coder. Without this the workspace is read-only to the agent and npm cannot
# write its cache — which silently turns `npm install` into a failure.
for dir in /workspace /home/coder/.npm; do
  if [ -d "$dir" ]; then
    chown coder:coder "$dir" 2>/dev/null || true
  fi
done

exec /usr/sbin/sshd -D -e
