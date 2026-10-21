# Proxy Toggler

<p align="center">
  <a href="https://github.com/bluecloud-dev/proxy-toggler/actions/workflows/ci.yml">
    <img src="https://github.com/bluecloud-dev/proxy-toggler/actions/workflows/ci.yml/badge.svg" alt="CI status">
  </a>
  <a href="https://github.com/bluecloud-dev/proxy-toggler/releases">
    <img src="https://img.shields.io/github/v/release/bluecloud-dev/proxy-toggler?include_prereleases&label=release" alt="Latest release">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/bluecloud-dev/proxy-toggler" alt="License">
  </a>
</p>

<p align="center">
  <img src="assets/hero.png" alt="Proxy Toggler banner" width="600">
</p>

<p align="center">
  Switch VS Code's HTTP proxy between proxy profiles and off, from the status bar.
</p>

<!-- Marketplace badges will go here once published -->

---

## Table of Contents

- [Features](#star-features)
- [Requirements](#clipboard-requirements)
- [Quick Start](#zap-quick-start)
- [Commands](#keyboard-commands)
- [Keybindings](#keyboard-keybindings)
- [Settings](#gear-settings)
- [How VS Code Uses Proxy Settings](#globe_with_meridians-how-vs-code-uses-proxy-settings)
- [How It Works](#bulb-how-it-works)
- [Security](#lock-security)
- [Troubleshooting](#wrench-troubleshooting)
- [Contributing](#handshake-contributing)
- [License](#page_facing_up-license)

## :star: Features

- **Proxy profiles**: keep several proxies and switch between them from the status bar gear
- **One-click toggle** from the Command Palette or status bar
- **Test Connection** checks a profile's proxy against a URL you pick, and says which side of VS
  Code reaches it directly
- **No stored credentials**: when a proxy asks for a sign-in, VS Code shows its own login dialog
- **Visual status indicator** showing on or off and the current profile
- **Optional confirmation prompt** before toggling
- **Strict SSL and no-proxy list** support
- **Remote windows**: in SSH, Tunnels and remote container windows, the toggle manages the remote
  machine's own proxy settings and leaves local windows alone
- **Non-invasive** — leaves system proxy configuration untouched

## :clipboard: Requirements

- VS Code **1.97** or later

## :zap: Quick Start

1. Install from the [VS Code Marketplace](#) or via VSIX:

   ```sh
   code --install-extension proxy-toggler-*.vsix
   ```

2. Open Command Palette (`Cmd/Ctrl+Shift+P`) and run:

   ```
   Proxy Toggler: Configure Proxy Settings
   ```

3. Enter the proxy URL, then a name for the profile. When VS Code already uses a proxy, setup
   starts from it.

4. Toggle the proxy using any of these methods:
   - Click the status bar indicator
   - Run `Proxy Toggler: Toggle Proxy` from Command Palette
   - Use the Turn Proxy On and Turn Proxy Off commands directly

5. Switch profiles by clicking the gear next to the indicator, or run
   `Proxy Toggler: Switch Profile…`. The list opens on the current profile, so Enter keeps it, or
   turns it on while the proxy is off.

## :keyboard: Commands

| Command                                   | Description                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `Proxy Toggler: Configure Proxy Settings` | Add the first profile, or edit the current one                            |
| `Proxy Toggler: Switch Profile…`          | Pick a profile to turn on, turn the proxy on or off, or open the settings |
| `Proxy Toggler: Turn Proxy On`            | Turn the current profile on                                               |
| `Proxy Toggler: Turn Proxy Off`           | Turn the proxy off                                                        |
| `Proxy Toggler: Toggle Proxy`             | Turn the current profile on, or the proxy off                             |

## :keyboard: Keybindings

Proxy Toggler adds no keyboard shortcuts of its own. To add yours, run **Preferences: Open
Keyboard Shortcuts (JSON)** and add entries like these:

```json
[
  { "key": "ctrl+alt+p", "command": "proxyToggler.toggle" },
  { "key": "ctrl+alt+w", "command": "proxyToggler.switchProfile", "args": "Work" },
  { "key": "ctrl+alt+h", "command": "proxyToggler.switchProfile", "args": "Home" }
]
```

- `args` names the profile to turn on, ignoring letter case. An unknown name shows an error and
  opens the switcher; without `args`, the command opens the switcher.
- Renaming a profile breaks the keybindings that use its old name. Proxy Toggler warns when you
  rename one, so you can update them.
- Pick keys that nothing else uses: in the Keyboard Shortcuts editor, right-click a binding and
  choose **Show Same Keybindings** to see conflicts. Leave the Command Palette's own shortcut,
  `Ctrl+Shift+P` (`Cmd+Shift+P` on macOS), and `F1` alone.

## :gear: Settings

| Setting                                | Type    | Default | Description                                                                                                                                     |
| -------------------------------------- | ------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `proxyToggler.profiles`                | array   | `[]`    | The proxy profiles, shared by every VS Code Profile. Edit them in the application settings (**Preferences: Open Application Settings (JSON)**). |
| `proxyToggler.confirmBeforeToggle`     | boolean | `false` | Ask before the status bar toggle or the Toggle Proxy command turns the proxy on or off                                                          |
| `proxyToggler.showSwitchNotifications` | boolean | `false` | Show a short notification naming the profile when the proxy turns on or off or switches profiles                                                |

### Managed VS Code Settings

This extension manages the following VS Code settings:

- `http.proxy` — The proxy URL
- `http.proxyStrictSSL` — Whether to verify SSL certificates
- `http.noProxy` — Hosts to exclude from proxy

## :globe_with_meridians: How VS Code Uses Proxy Settings

### Signing in to a proxy

Profiles hold no user name or password. When a proxy asks for a sign-in (HTTP status 407), VS Code
shows its own login dialog and can remember what you enter.

- VS Code's own requests, such as Marketplace searches, answer Basic, Digest, NTLM and Negotiate
  sign-ins through that dialog.
- Extensions' `https://` requests answer Basic sign-ins through the same dialog. Their plain
  `http://` requests through a proxy that asks for Basic sign-in fail with the 407: VS Code never
  shows the dialog for those.

### Settings Sync

Settings Sync uploads both the `http.*` settings and `proxyToggler.profiles` while its Settings
category is on:

- `http.proxy`, `http.proxyStrictSSL` and `http.noProxy` carry the proxy in use, including any
  `user:pass@` someone wrote into `http.proxy`;
- `proxyToggler.profiles` carries every profile: names, proxy hosts and bypass patterns.

To keep either on one machine, list it in `settingsSync.ignoredSettings`, for example
`"settingsSync.ignoredSettings": ["http.proxy", "proxyToggler.profiles"]`. What Proxy Toggler
remembers on a machine, such as the current profile and on or off, is never synced.

When Settings Sync shows a conflict in `proxyToggler.profiles`, for example after two machines each
copied their 0.1.x configuration into a profile, keep the entries of both sides. If both hold a
profile with the same name, Proxy Toggler shows the first and warns about the other.

### VS Code Profiles

VS Code's proxy settings are shared by all VS Code Profiles: turning the proxy on in one turns it on
in all of them. Proxy Toggler's profiles are shared the same way, and live in the Default profile's
settings file (**Preferences: Open Application Settings (JSON)**). Each VS Code Profile remembers
its own current profile.

### Bypass patterns

The VS Code window and extensions read the bypass list differently. They agree on:

- exact host names, such as `intranet.example.com`;
- domains written with a leading dot, such as `.example.com`, for their subdomains.

Loopback addresses (`localhost`, `127.0.0.1` and `::1`) always go direct, so a profile needs no
bypass entry for them. Prefer `.example.com` to `*.example.com`: extensions never match a pattern such
as `*.example.com`, which only the window reads. A bypass list affects the `NO_PROXY` environment variable too: while
`http.noProxy` is empty, VS Code reads `NO_PROXY`; any entry makes it ignore `NO_PROXY`.

### What "off" means

Turning the proxy off removes `http.proxy`, `http.proxyStrictSSL` and `http.noProxy` from your
settings, so Proxy Toggler sets no proxy. What VS Code uses next depends on how it started:

- Until VS Code restarts, its own requests and extensions' requests go direct, unless VS Code's
  environment sets `HTTP_PROXY` or `HTTPS_PROXY`; both then use that proxy.
- After a restart, VS Code uses your system's proxy settings or a PAC file again, if you have one.

The proxy lab measured this on VS Code 1.97 and the latest release; see
[TESTING.md](TESTING.md#what-off-does).

### `http.proxySupport`

This setting decides how extensions use proxies: `override` (the default) applies VS Code's proxy
settings to them, and `off` leaves extensions without any proxy support, so they ignore VS Code's
proxy settings and the system's. Test Connection notes when it is `off`.

### Remote windows

In a remote window, such as SSH, Tunnels, WSL or a Dev Container, Proxy Toggler runs on the remote
side, so it must be installed there too. Click **Install in SSH: devbox**, or the button for your
remote, on Proxy Toggler in the Extensions view. To install it on every remote, list
`aymenhammouda.proxy-toggler` in `remote.defaultExtensionsIfInstalledLocally` (VS Code 1.99 and
later), `remote.SSH.defaultExtensions` or `dev.containers.defaultExtensions`.

The remote side of a window uses one of two sets of proxy settings. The remote machine's
`http.useLocalProxyConfiguration` setting chooses which:

| Remote                          | Proxy settings by default | What the toggle and switcher change                                                                                               |
| ------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| SSH, Tunnels, remote containers | The remote machine's own  | The remote machine's settings, while local windows keep their proxy. The status bar names the host, as in `Proxy (devbox): Work`. |
| WSL, local Dev Containers       | This computer's           | This computer's settings, as in a local window. The tooltip says so.                                                              |

When the remote machine keeps its own settings:

- Proxy Toggler remembers on or off and the current profile on that machine, for every window
  connected to it. Local windows keep their own.
- The status bar shows the host name, or the remote type for containers, whose host names are
  generated.
- Turning the proxy off writes an empty `http.proxy` to the remote machine's settings instead of
  removing it. Without a value there, VS Code can hand the remote side this computer's proxy while
  a window starts ([TESTING.md](TESTING.md#remote-windows), checks 1 and 6). For the same reason,
  Proxy Toggler shows only what the remote machine's own settings hold.
- The VS Code window itself, with its Marketplace searches, still uses this computer's proxy
  settings.

Test Connection runs on the remote side and says where it ran. Where the remote uses this
computer's settings, the VS Code window connects from this computer, so the test does not cover it.

#### Giving a WSL or container remote its own proxy

WSL and local Dev Containers use this computer's proxy settings by default. When their remote side
needs another proxy, pick **Use a Separate Proxy for This Remote** in the switcher. Proxy Toggler
sets `http.useLocalProxyConfiguration` to `false` in the remote machine's settings, which applies
without a reload, and from then on the toggle manages that remote's own proxy.

**Use This Computer's Proxy Again** reverses it, and removes the remote machine's `http.*` values:
while they remain, a later write would land in the remote file and change nothing.

A proxy on a loopback address, such as `127.0.0.1`, is this computer for the VS Code window, but not
for WSL in its default NAT mode, nor for a container. While the current profile uses one, the
switcher lists **Use a Separate Proxy for This Remote** first.

## :bulb: How It Works

```mermaid
flowchart LR
    U["You trigger Enable/Disable/Toggle"] --> E["Proxy Toggler"]
    E --> C["Apply VS Code settings<br/>(http.proxy, http.proxyStrictSSL, http.noProxy)"]
    C --> VS["VS Code network layer"]
    VS --> Net["Outbound requests"]
    E --> SB["Status bar indicator"]
```

## :lock: Security

- **No stored credentials**: profiles hold no user name or password, and Proxy Toggler never
  writes credentials to `settings.json`, `globalState`, logs, or messages. When a proxy asks for a
  sign-in, VS Code's own login dialog asks you
- **No `http.proxyAuthorization`** header is set by this extension
- The username and password that 0.1.x stored in your OS keychain are deleted, with a one-time notice
- **Works in Restricted Mode**: the extension reads no workspace files, so it stays available in folders you have not trusted
- **Report vulnerabilities privately**; see [SECURITY.md](SECURITY.md)

### Trusting a company's certificate authority

Some companies inspect HTTPS traffic through a proxy that signs certificates with the company's own
certificate authority.

- The VS Code window, and extensions by default, trust the authorities in your operating system's
  certificate store (`http.systemCertificates`, on by default). Install the company's authority
  there.
- VS Code's command line, such as `code --install-extension`, uses Node's built-in list instead.
  Point the `NODE_EXTRA_CA_CERTS` environment variable at the authority's certificate, a PEM file.
- Test Connection checks certificates against Node's built-in list only, so it warns about a
  company authority even when VS Code trusts it, and names that authority.

## :wrench: Troubleshooting

**Toggle not changing settings?**
Ensure user-level proxy settings aren't being overridden by workspace settings.

**Connection still blocked after enabling?**
Some environments require system-level proxy configuration. This extension only manages VS Code's internal HTTP proxy settings.

**Asked to sign in to the proxy?**
VS Code shows its own login dialog when the proxy asks for credentials; Proxy Toggler stores none.

**Something failed and the notification did not say why?**
Open **View → Output** and pick **Proxy Toggler** in the dropdown. Errors are logged there with details; credentials never are.

## :handshake: Contributing

### Getting started

You need Node.js 24 (the version in `.nvmrc`; run `nvm use` if you use nvm) and VS Code 1.97 or later.

```sh
git clone https://github.com/bluecloud-dev/proxy-toggler.git
cd proxy-toggler
npm ci
npm run check
```

`npm run check` runs the format check, lint, the unused-code check, the type check, and the unit and security tests with coverage. It is what CI runs before the integration tests.

### Run the extension

1. Run `npm run watch` to rebuild `dist/extension.js` on every change, or `npm run build` once.
2. Open the folder in VS Code and press `F5`. If VS Code asks for a debugger, choose **VS Code Extension Development**.
3. Use the commands in the new Extension Development Host window. Errors appear in **Output → Proxy Toggler**.

### Common workflows

| Task                                              | Command                    |
| ------------------------------------------------- | -------------------------- |
| Format all project files                          | `npm run format`           |
| Lint (ESLint with type information)               | `npm run lint`             |
| Find unused files, exports, and dependencies      | `npm run lint:unused`      |
| Type-check                                        | `npm run typecheck`        |
| Unit and security tests                           | `npm test`                 |
| The same, with the coverage gate                  | `npm run coverage`         |
| Integration tests in VS Code (minimum and stable) | `npm run test:integration` |
| Build the VSIX and check its contents             | `npm run package`          |
| Run the built VSIX in Restricted Mode             | `npm run test:packaged`    |

On Linux without a display, prefix the integration and packaged tests with `xvfb-run -a`. The first run downloads VS Code into `.vscode-test/`.

### Where to look next

- [ARCHITECTURE.md](ARCHITECTURE.md): layers, persisted data, the error model, and design decisions.
- [TESTING.md](TESTING.md): how the tests are organized, the shared fakes, and the manual QA checklist.
- [QUALITY_BASELINE.md](QUALITY_BASELINE.md): the coding, TypeScript, extension, and dependency standards.
- [CONTRIBUTING.md](CONTRIBUTING.md): what to read and run before a pull request.
- [SECURITY.md](SECURITY.md): how to report a vulnerability, and the security controls with their tests.
- [CHANGELOG.md](CHANGELOG.md): version history.

## :page_facing_up: License

[MIT](LICENSE)

---

<p align="center">
  <a href="https://github.com/bluecloud-dev/proxy-toggler/issues/new?template=bug_report.yml">Report a Bug</a>
  ·
  <a href="https://github.com/bluecloud-dev/proxy-toggler/issues/new?template=feature_request.yml">Request a Feature</a>
  ·
  <a href="https://github.com/bluecloud-dev/proxy-toggler/security/advisories/new">Report a Vulnerability</a>
</p>
