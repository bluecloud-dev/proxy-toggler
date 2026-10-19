#!/bin/sh
# Generates a self-signed certificate for the lab origin each time the container starts, so that
# no private key is ever committed, then hands over to the nginx image's own entrypoint.
set -eu

mkdir -p /run/origin-tls
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 30 \
  -subj '/CN=origin.lab.test' \
  -addext 'subjectAltName=DNS:origin.lab.test,DNS:localhost,IP:127.0.0.1' \
  -keyout /run/origin-tls/origin.key -out /run/origin-tls/origin.crt

exec /docker-entrypoint.sh "$@"
