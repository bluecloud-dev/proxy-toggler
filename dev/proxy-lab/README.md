# Proxy lab

Real proxy software in Docker, for testing Proxy Toggler, and VS Code itself, against the kinds of
proxies its users sit behind, in local windows and in remote windows on an SSH host. Every port is
published on the host's `127.0.0.1` only, so nothing in the lab is reachable from the network.
`npm run check` and the pull request checks do not use the lab.

[TESTING.md](../../TESTING.md#manual-qa-with-the-proxy-lab) says what to enter in **Proxy Toggler:
Configure Proxy Settings** for each proxy, what to expect, and what `http.proxyStrictSSL` does.

## Start and stop

You need Docker with the Compose plugin (`docker compose`). From the repository root:

```bash
npm run proxy-lab:up
```

```bash
npm run proxy-lab:down
```

`proxy-lab:up` returns once every container runs and the SSH host accepts connections. The first
run builds the SSH host's image, which downloads Debian packages. `proxy-lab:down` removes the
containers, and with them the certificates, the password file, and the SSH keys they generated.

## Services

| Service      | Address on the host                               | Image                                                   | What it is                                                                                             |
| ------------ | ------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `squid-open` | `http://127.0.0.1:3128`                           | `ubuntu/squid`                                          | Forward proxy without authentication.                                                                  |
| `squid-auth` | `http://127.0.0.1:3129`                           | `ubuntu/squid`                                          | Forward proxy that asks for Basic credentials.                                                         |
| `mitmproxy`  | `http://127.0.0.1:8080`                           | `mitmproxy/mitmproxy`                                   | Forward proxy that intercepts HTTPS with its own certificate authority, which no client trusts.        |
| `socks5`     | `socks5://127.0.0.1:1080`                         | `mitmproxy/mitmproxy`                                   | SOCKS5 relay that passes every connection through without intercepting it.                             |
| `pac`        | `http://127.0.0.1:8000/proxy.pac`                 | `nginx` (Alpine)                                        | Serves [`pac/proxy.pac`](pac/proxy.pac).                                                               |
| `origin`     | `http://127.0.0.1:8088`, `https://127.0.0.1:8443` | `nginx`                                                 | Web server with a self-signed certificate. Through a proxy it is `origin.lab.test`, on the same ports. |
| `ssh-host`   | `127.0.0.1:2222`, user `lab`                      | `debian`, built from [`ssh/Dockerfile`](ssh/Dockerfile) | SSH server for VS Code's Remote-SSH extension. See [Remote windows](#remote-windows).                  |

`origin.lab.test` resolves only inside the lab's Docker network, so a reply from it proves that the
request went through a lab proxy. The reply names the address the request came from.

`ssh-host` sits on a second Docker network, `remote`, which the four proxies join too. From the SSH
host they are `http://squid-open:3128`, `http://squid-auth:3128`, `http://mitmproxy:8080`, and
`socks5://socks5:1080`. `origin.lab.test` does not resolve there either, so a remote request also
reaches the origin only through a proxy. The SSH host's own `127.0.0.1` runs no proxy, which shows
when a remote request takes a local proxy address.

The PAC file sends `*.lab.test` to `squid-open`, the Marketplace (`*.visualstudio.com` and
`*.vsassets.io`) to `squid-auth`, and everything else direct. Only the VS Code desktop app reads a
PAC file; start it with `--proxy-pac-url=http://127.0.0.1:8000/proxy.pac` and a `--user-data-dir`
of its own. Without its own user data directory, the command hands its arguments to the VS Code
that is already running, which keeps the proxy configuration it started with.
`code --install-extension` ignores the switch.

## Test-only credentials and certificates

`squid-auth` accepts one fixed account: user `lab`, password `lab-secret`. It is for this lab only,
protects nothing, and must not be reused anywhere else. The container writes its password file
when it starts.

No key or certificate is committed. `origin` generates its self-signed certificate, for
`origin.lab.test`, `localhost`, and `127.0.0.1`, each time it starts. mitmproxy generates its
certificate authority when its container is created. To trust that authority in an experiment,
copy it out of the container:

```bash
docker compose -f dev/proxy-lab/compose.yaml cp mitmproxy:/home/mitmproxy/.mitmproxy/mitmproxy-ca-cert.pem /tmp/
```

`ssh-host` generates its host keys and a key pair for the `lab` account when its container is
created. The account has no password, so only that key logs in; copy it out as described in
[Remote windows](#remote-windows).

## Logs

```bash
npm run proxy-lab:logs -- squid-open
```

Add `--follow` before the service name to keep watching. What to look for:

- Squid logs a tunnel when it closes, about a second late:
  `TCP_TUNNEL/200 9825 CONNECT marketplace.visualstudio.com:443`. A request without credentials
  to `squid-auth` shows as `TCP_DENIED/407`, and an authenticated one names the user `lab`.
- mitmproxy logs a client that rejected its certificate as
  `Client TLS handshake failed. The client does not trust the proxy's certificate for ...`, and a
  request it intercepted as `POST https://marketplace.visualstudio.com/...`.
- `pac` logs each download of the PAC file: `"GET /proxy.pac HTTP/1.1" 200`.
- `ssh-host` logs each login: `Accepted publickey for lab from 172.19.0.1`.

## Check the lab with curl

```bash
curl -x http://127.0.0.1:3128 http://origin.lab.test:8088/
```

```bash
curl -x http://127.0.0.1:3129 --proxy-user lab http://origin.lab.test:8088/
```

```bash
curl --socks5-hostname 127.0.0.1:1080 http://origin.lab.test:8088/
```

```bash
curl -x http://127.0.0.1:8080 https://marketplace.visualstudio.com/
```

The first three print a line from the origin; curl asks for the `lab` password in the second. The
last one fails with a certificate error, because curl does not trust mitmproxy's authority.

## Remote windows

To open a VS Code window on the SSH host by hand, copy the lab's key out of the container:

```bash
docker compose -f dev/proxy-lab/compose.yaml cp ssh-host:/run/ssh-lab/id_ed25519 /tmp/proxy-lab-key
```

Then save this as `/tmp/proxy-lab-ssh-config`. The host key changes each time the container is
created, so the configuration does not record it:

```text
Host proxy-lab
  HostName 127.0.0.1
  Port 2222
  User lab
  IdentityFile /tmp/proxy-lab-key
  IdentitiesOnly yes
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
```

Set `remote.SSH.configFile` to `/tmp/proxy-lab-ssh-config` and run **Remote-SSH: Connect to
Host...** with `proxy-lab`. Remote-SSH installs the VS Code server in `/home/lab/.vscode-server`;
**Preferences: Open Remote Settings (SSH: proxy-lab)** opens the SSH host's machine settings,
`/home/lab/.vscode-server/data/Machine/settings.json`. In that window, use the proxy addresses
that the SSH host reaches, such as `http://squid-open:3128`.

## The probe

With the lab running, `npm run proxy-lab:probe` starts VS Code, on the minimum supported release
and on stable, with the proxy settings that Proxy Toggler writes, and checks every result against
the proxy logs. The remote checks open Remote-SSH windows on `ssh-host`, on VS Code 1.97.0 and on
stable. The probe needs internet access to reach the Marketplace and to install Remote-SSH and the
VS Code server. On Linux without a display, run it as `xvfb-run -a npm run proxy-lab:probe`.
`npm run proxy-lab:probe -- SSH` runs only the checks whose name contains `SSH`.
[TESTING.md](../../TESTING.md#the-probe) lists the checks.

## Troubleshooting

- `proxy-lab:up` fails with "port is already allocated": another program uses one of the ports
  above. Stop it, or change the host side of that port in [`compose.yaml`](compose.yaml).
- A VS Code window with a lab proxy configured cannot reach the internet once the lab is down. Run
  **Proxy Toggler: Disable Proxy** before `proxy-lab:down`.
- A remote check fails with "did not close within 180 s": the Remote-SSH window waited for
  something, such as a prompt. Run that check alone and watch the window. **Output → Remote - SSH**
  shows the connection log.
