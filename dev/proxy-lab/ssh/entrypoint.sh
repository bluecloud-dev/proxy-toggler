#!/bin/sh
# Generates the SSH host keys and a key pair for the lab account when the container starts, so
# that no key is ever committed, then runs sshd in the foreground with its log on the container
# output. The private key stays in the container until a client copies it out (README.md).
set -eu

ssh-keygen -A
mkdir -p /run/sshd /run/ssh-lab

if [ ! -f /run/ssh-lab/id_ed25519 ]; then
  ssh-keygen -q -t ed25519 -N '' -C 'proxy lab, test only' -f /run/ssh-lab/id_ed25519
fi
install -d -m 700 -o lab -g lab /home/lab/.ssh
install -m 600 -o lab -g lab /run/ssh-lab/id_ed25519.pub /home/lab/.ssh/authorized_keys

exec /usr/sbin/sshd -D -e
