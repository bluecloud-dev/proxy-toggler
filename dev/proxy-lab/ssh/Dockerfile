# The SSH host that VS Code's Remote-SSH extension connects to, for the remote-window checks.
# Remote-SSH does not support Alpine hosts, so this is Debian with the packages its server needs:
# bash, tar, and curl or wget (https://code.visualstudio.com/docs/remote/linux).
FROM debian:13.7-slim

# The package generates host keys when it installs; entrypoint.sh generates new ones in each
# container instead, so none is baked into the image. The lab account has no password, so only
# the key that entrypoint.sh generates logs in.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-server curl ca-certificates procps \
  && rm -rf /var/lib/apt/lists/* /etc/ssh/ssh_host_* \
  && useradd --create-home --shell /bin/bash lab \
  && usermod --password '*' lab
