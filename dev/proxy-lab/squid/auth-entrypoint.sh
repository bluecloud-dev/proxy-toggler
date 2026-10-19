#!/bin/sh
# Writes the password file for squid-auth, then hands over to the image's own entrypoint.
#
# The account is fixed and for testing only: user "lab", password "lab-secret". It exists only
# inside this container, and only the host's 127.0.0.1 can reach the proxy. The file is written
# at start-up so that no password hash is committed.
set -eu

# The image has no coreutils, so the file goes straight into /run, which the Squid user owns.
printf 'lab:%s\n' "$(printf '%s' 'lab-secret' | openssl passwd -apr1 -stdin)" >/run/squid-lab-passwd

exec /usr/bin/pebble enter "$@"
