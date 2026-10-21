# Testing

## Layers

| Layer       | Location             | Runs in                                                          | Command                                    |
| ----------- | -------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| Unit        | `tests/unit/`        | Node, with Mocha and ts-node, against fakes                      | `npm test`                                 |
| Security    | `tests/security/`    | Same as unit                                                     | `npm test`                                 |
| Integration | `tests/integration/` | A real VS Code Extension Development Host, on two versions       | `npm run test:integration`                 |
| Packaged    | `tests/packaged/`    | A real VS Code with the VSIX installed, in an untrusted folder   | `npm run package && npm run test:packaged` |
| Proxy lab   | `tests/proxy-lab/`   | A real VS Code, local and over SSH, against the Docker proxy lab | `npm run proxy-lab:probe`                  |

`npm run check` runs the format check, lint, the unused-code check, the type check, and the unit
and security tests with coverage. CI runs the same steps, then the integration tests, the
no-telemetry guard, the high-severity `npm audit`, and the packaged tests on the VSIX it built. On
Windows and macOS, CI runs the integration and packaged tests too, because credential storage and
settings files differ by operating system. The proxy lab probe needs Docker and internet access,
so it runs only when started by hand; see [The probe](#the-probe).

## Coverage

`npm run coverage` fails below 80% for statements, branches, functions, or lines (`nyc` settings in
`package.json`). `src/extension.ts` is excluded: it only loads inside VS Code, where the
integration tests run it.

## Integration tests

- `tests/run-test.ts` runs the suite twice, each time in a fresh temporary profile: on the minimum
  release from `engines.vscode`, then on the latest stable release. Downloads are cached in
  `.vscode-test/`.
- On Linux without a display, use `xvfb-run -a npm run test:integration`.
- The suite runs with Mocha 11 because the extension host of the minimum VS Code release must be
  able to `require` the runner. Mocha 12 is ESM-only.
- Every `*.test.ts` file under `tests/integration/` is loaded; `support.ts` holds shared helpers.
- The tests change real user settings in the throwaway profile only.

## Network tests

`tests/integration/network.test.ts` checks that VS Code's traffic follows the settings the
extension writes; the other integration tests only check the settings. It runs with them, on both
VS Code versions, and sends requests from the extension host through a local proxy:

- With the proxy on, a request for `http://origin.invalid/hello` reaches the proxy, which
  answers it. After **Turn Proxy Off**, the same request goes direct, fails with `ENOTFOUND`, and
  the proxy sees nothing new.
- A host in the bypass list goes direct, while other hosts still go through the proxy.
- An HTTPS request asks the proxy for a tunnel: `CONNECT origin.invalid:443`.
- Credentials inside the `http.proxy` URL authenticate that `CONNECT`. The test writes
  `http.proxy` itself, because the extension refuses credentials in the URL on purpose.
- VS Code's own requests follow the setting too: a search in the Extensions view reaches the proxy
  as a `CONNECT` to `marketplace.visualstudio.com`.

The proxy is `tests/support/test-proxy.ts`, which has no dependencies. `startTestProxy()` listens
on a free port of 127.0.0.1 and records every request as `{ method, url, host, authorized }`. It
answers plain-HTTP proxy requests itself with `PROXY_ANSWER`, so no origin server is needed. It
refuses `CONNECT` with 502, or tunnels it to the local port given as `tunnelTo`. With
`credentials`, it answers 407 with `Proxy-Authenticate: Basic` until the right
`Proxy-Authorization` arrives, on plain requests and on `CONNECT`. `close()` also closes open
connections and tunnels. `tests/unit/test-proxy.test.ts` pins this behavior in plain Node.

Rules for network tests:

- Send requests to a `.invalid` host, which the proxy answers itself. Such a name never resolves,
  so a request that skips the proxy fails. Loopback hosts do not work: VS Code never sends them
  through a proxy, and the extension's default bypass list is `localhost,127.0.0.1`.
- Assert only on the proxy's entries for your own host (`requestsFor(host)`). Once the proxy is
  enabled, VS Code's own background traffic reaches it too; an assertion on the whole log broke on
  VS Code 1.142.0.
- Allow for VS Code's own processes to apply a settings change after the extension host does. For
  a host without a proxy setting, the extension host asks the main process for a route and caches
  the answer per host, so one request sent too early keeps the stale route. On 1.91.0, the first
  requests after **Disable** still went through a proxy that an earlier test had enabled. The
  tests therefore probe new `.invalid` names until one goes direct before they check the host
  under test, and the test of VS Code's own traffic repeats its search.
- Clean up in `afterEach`: disable the proxy, remove every `http.*` user setting the test set, and
  close the servers. Disable before `sandbox.restore()`: otherwise a real "Proxy disabled"
  notification waits for a click and the hook times out.
- Generate credentials at run time, and commit no keys or certificates: GitGuardian and CodeQL
  scan this public repository.
- Do not assert that `http.proxyAuthorization` works: the extension host does not apply it. The
  `lookupProxyAuthorization` of VS Code 1.91.0 only handles Kerberos and Negotiate challenges, and
  an experiment saw a 407 with no `Proxy-Authorization` header even with the setting present.
  This is known VS Code behavior.
- Do not test `http.proxyStrictSSL` here: the extension host's network stack ignores it, and a
  self-signed origin and a self-signed HTTPS proxy behaved the same with either value. VS Code's
  own request service and some bundled extensions read it, so testing it needs another probe,
  such as a Docker lab or the VS Code CLI.

On a machine where `HTTP_PROXY` or `HTTPS_PROXY` is set, the checks that expect a direct request
fail, because VS Code uses those variables when `http.proxy` is empty. CI runners set neither.

## Packaged tests

- `tests/run-packaged-test.ts` installs the VSIX that `npm run package` built into a fresh
  profile and opens an empty folder that nobody has trusted, so VS Code is in Restricted Mode. It
  runs on the same two VS Code versions as the integration tests.
- They test the installed package because VS Code ignores Workspace Trust for an extension loaded
  with `--extensionDevelopmentPath`: the integration tests would pass even if the manifest did not
  declare trust support. VS Code loads extension tests only in a development host, so the empty
  extension in `tests/packaged/host/` loads `tests/packaged/index.ts`.
- On Linux without a display, use `xvfb-run -a npm run test:packaged`.

## Writing tests

- Use the shared fakes instead of writing new stubs:
  - `tests/support/fake-vscode.ts`: `createFakeVscode()` records messages, executed commands,
    setting writes, status bar items, and log lines, and answers prompts from the options you
    pass.
  - `tests/support/fakes.ts`: `createMemento`, `createSecretStorage`, `createHttpSettings`,
    `createNotificationRecorder`, `createExtensionContext`, and `flushBackgroundTasks`.
- For a test that needs a real proxy, use `startTestProxy()` from `tests/support/test-proxy.ts`
  and follow the rules in [Network tests](#network-tests).
- To simulate VS Code echoing an older stored state, set that state in the `store` of the fake
  memento (`createMemento`) after the action under test.
- To test what happens while a notification is open, return a promise from the `answer` option
  and settle it after the action under test. To make setting writes fail, pass `failKey` (every
  write to one setting) or `failWhen` (the writes it matches) to `createHttpSettings`.
- Answers in `inputs` run through the prompt's `validateInput`. One that it rejects throws,
  because a user could not submit it in VS Code.
- Test through exported functions and classes, and assert on what the user or VS Code would see
  (messages, settings, persisted values), not on private state.
- Keep one test file per source module, named after the module. Tests of the composition root,
  `createProxyToggler` with the fake VS Code, are grouped by behavior instead, one file for each,
  such as `drift.test.ts` or `remote-windows.test.ts`. Name each test after the behavior it pins.
- Security tests must keep proving that credentials never reach `globalState`, messages, or logs.

## Manual QA checklist

Run these in the Extension Development Host (F5) before a release, or after changes to the flows
they cover.

- [ ] With no profile and no proxy in VS Code, the toggle shows "Proxy: Not Configured", and a
      click starts **Add Profile…**: the proxy URL, then the name, which defaults to the proxy
      host, with a working Back button. The bypass list starts empty. Saving offers **Turn On**,
      **Test Connection** and **Not Now**.
- [ ] Turn the proxy on: user settings contain `http.proxy`, `http.proxyStrictSSL`, and an
      `http.noProxy` array; the status bar shows "Proxy: ON", or the profile's name with two or
      more profiles; the Command Palette offers **Turn Proxy Off** but not **Turn Proxy On**.
- [ ] Turn it off: the three settings are removed and the status bar shows "Proxy: OFF".
- [ ] The gear opens the switcher: the profiles alphabetically, the current one checked and
      focused, then the actions. Picking a profile turns it on.
- [ ] **Edit Profile…** saves one field at a time, and a rename warns about keybindings.
      **Delete Profile…** asks first.
- [ ] Toggle from the status bar item, with `proxyToggler.confirmBeforeToggle` both off and on.
- [ ] Drift: edit `http.proxy` by hand. The toggle shows the warning icon, and the switcher offers
      **Save Current Settings as Profile…**, plus **Re-apply** or **Turn Proxy Off**.
- [ ] Two windows in two VS Code Profiles: a switch in one shows in the other's status bar.
- [ ] **Test Connection…** from **Edit Profile…**: the URL is prefilled with the Marketplace, and
      the result shows once and never reaches **Output → Proxy Toggler**.
- [ ] Policy or read-only settings: when a setting cannot be written, the error offers **Open
      Settings**.
- [ ] Upgrade from 0.1.x with a saved configuration: a profile named after the proxy host is
      current and off, and stored credentials are removed with a one-time notice.
- [ ] An SSH window: the status bar names the host, and switching writes only the remote
      machine's settings. In a WSL window, the tooltip says it manages this computer's settings.
- [ ] The **Proxy Toggler** output channel never contains a username or password.
- [ ] A screen reader announces the toggle's state, such as "Proxy on, profile Work".

## Manual QA with the proxy lab

[`dev/proxy-lab/`](dev/proxy-lab/README.md) runs Squid, mitmproxy, a PAC server, and a web server
in Docker, on `127.0.0.1` only. Start it with `npm run proxy-lab:up`, watch a proxy with
`npm run proxy-lab:logs -- --follow <service>`, and stop it with `npm run proxy-lab:down`.

Proxy Toggler stores no proxy credentials. Turning a profile on writes only `http.proxy`,
`http.proxyStrictSSL`, and `http.noProxy`, and the URL prompt rejects credentials inside the URL.
When a proxy asks for credentials, VS Code asks the user itself.

For each row, add a profile with the values given (**Add Profile…** in the switcher, then edit its
strict SSL choice and bypass list), and turn it on. Then search in the Extensions view: the search
makes VS Code send its own requests through the proxy.

| Lab proxy    | Proxy URL                 | Bypass list                    | Strict SSL | Expected result                                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ------------------------- | ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `squid-open` | `http://127.0.0.1:3128`   | none                           | Yes        | The search shows results, and the `squid-open` log shows `TCP_TUNNEL/200 … CONNECT marketplace.visualstudio.com:443`. After **Turn Proxy Off**, new searches add no lines.                                                                                                                                                                                                            |
| `squid-open` | `http://127.0.0.1:3128`   | `marketplace.visualstudio.com` | Yes        | The search shows results, and the log gains no `CONNECT marketplace.visualstudio.com:443` line: VS Code reaches that host directly. Other hosts, such as `*.gallerycdn.vsassets.io`, still go through the proxy.                                                                                                                                                                      |
| `squid-auth` | `http://127.0.0.1:3129`   | none                           | Yes        | VS Code shows its own proxy sign-in prompt, where the lab's test-only account works: user `lab`, password `lab-secret`, and the log shows `TCP_DENIED/407 … CONNECT marketplace.visualstudio.com:443`. Proxy Toggler stores no credentials.                                                                                                                                           |
| `mitmproxy`  | `http://127.0.0.1:8080`   | none                           | Yes        | The search fails, and the `mitmproxy` log shows `The client does not trust the proxy's certificate for marketplace.visualstudio.com`.                                                                                                                                                                                                                                                 |
| `mitmproxy`  | `http://127.0.0.1:8080`   | none                           | No         | The same failure. The desktop app checks certificates whatever `http.proxyStrictSSL` says; see below.                                                                                                                                                                                                                                                                                 |
| `socks5`     | `socks5://127.0.0.1:1080` | none                           | none       | Add Profile accepts the URL. What VS Code does with a SOCKS proxy is not measured here.                                                                                                                                                                                                                                                                                               |
| `pac`        | none: turn the proxy off  | none                           | none       | Start VS Code with `--proxy-pac-url=http://127.0.0.1:8000/proxy.pac` and a `--user-data-dir` of its own. The `pac` log shows the download, and a search brings up VS Code's proxy sign-in prompt, because the PAC file sends the Marketplace to `squid-auth`. Then turn on the `squid-open` profile: searches go through it, because `http.proxy` takes precedence over the PAC file. |

### What `http.proxyStrictSSL` does

Measured through `mitmproxy`, whose certificate authority no client trusts, with
`npm run proxy-lab:probe` on VS Code 1.91.0, 1.97.0 and 1.142.0 (macOS, October 2026):

| Client                                             | Strict SSL on                                                                            | Strict SSL off                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `code --install-extension`, VS Code's CLI          | Fails: "unable to verify the first certificate"                                          | Installs: the CLI accepts mitmproxy's certificate. Not on 1.97.0, whose CLI fails as with Strict SSL on |
| The Extensions view, in the desktop app            | Fails: Chromium rejects the certificate (`net_error -202`, `ERR_CERT_AUTHORITY_INVALID`) | Fails the same way                                                                                      |
| `https.get` in an extension, in the extension host | Fails: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`                                                 | Fails the same way                                                                                      |

So the setting changes only the requests of VS Code's Node.js request service, which the CLI uses,
and on 1.97.0 not even those.
The desktop app ignores it, both for its own Marketplace requests and for requests from
extensions. VS Code describes the setting as controlling "whether the proxy server certificate
should be verified"; the lab has no HTTPS proxy, so that case is not measured.

### What Off does

Turning the proxy off removes `http.proxy`, `http.proxyStrictSSL` and `http.noProxy` while VS Code
runs. Measured with `npm run proxy-lab:probe -- "App, Off:"` on VS Code 1.97.0 and 1.143.0
(macOS, October 2026): each check starts the desktop app with `http.proxy` set to `squid-open`,
removes the three settings, then sends requests from the extension host and searches the
Marketplace again.

| How VS Code started                     | Extensions' requests after Off | VS Code's own requests after Off           |
| --------------------------------------- | ------------------------------ | ------------------------------------------ |
| With `--proxy-pac-url`                  | Direct                         | Direct: the PAC file's proxies get nothing |
| With `HTTP_PROXY` and `HTTPS_PROXY` set | Through the proxy they name    | Through the proxy they name                |
| With `--proxy-pac-url`, after a restart | Through the PAC file's proxy   | Through the PAC file's proxy, on macOS     |

The last row is the probe's "App with only `--proxy-pac-url`" check: a restart with the settings
already removed. On Ubuntu, in the Proxy lab workflow, the window's Marketplace requests did not
take the PAC file's proxy after a restart: Chromium's net log shows them succeeding, and
`squid-auth` saw none, while the extension host still followed the PAC file. So until VS Code restarts, Off sends VS Code's traffic direct unless its
environment names a proxy; after a restart, a PAC file or the system's proxy applies again.

Decision: the Off tooltip says only that Proxy Toggler sets no proxy ("Proxy off: Proxy Toggler
sets no proxy"), because what VS Code uses next depends on its environment and on whether it has
restarted. The README's "What off means" explains the rest.

A Direct entry, which the roadmap keeps for later, would work: an empty `http.proxy` with
`http.noProxy: ["*"]` sends both extensions' and VS Code's own requests direct, whether written at
start-up or while VS Code runs, even with `--proxy-pac-url`.

### The probe

`npm run proxy-lab:probe` needs the lab running and internet access. For the `engines.vscode`
minimum, 1.97.0, and stable, it runs each check below in a fresh profile whose `settings.json` holds
the settings Proxy Toggler writes, and compares the outcome and the proxy logs with what this file
records. The app checks also record how the window's Marketplace requests ended, from Chromium's
net log. The CLI checks run `code --install-extension` on a small Marketplace extension. The app checks start the
desktop app with `tests/proxy-lab/index.ts`, which sends requests from the extension host and then
searches the Marketplace. The SSH checks open Remote-SSH windows; see
[Remote windows](#remote-windows). The Test Connection checks run Proxy Toggler's own test
(`src/core/test-connection.ts`) against the lab proxies, once per run, since no VS Code release is
involved. `npm run proxy-lab:probe -- <text>` runs only the checks whose name contains the text.

| Check                                                                                      | Expected                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI through `squid-open`                                                                   | Installs; `squid-open` logs the Marketplace tunnel.                                                                                                                                                                                                                  |
| CLI through `squid-auth`                                                                   | Fails, with the misleading message "Extension '…' not found"; `squid-auth` logs `TCP_DENIED/407`.                                                                                                                                                                    |
| CLI through `mitmproxy`, Strict SSL on                                                     | Fails; `mitmproxy` logs the failed TLS handshake.                                                                                                                                                                                                                    |
| CLI through `mitmproxy`, Strict SSL off                                                    | Installs; `mitmproxy` logs the intercepted Marketplace query. On 1.97.0, fails as with Strict SSL on.                                                                                                                                                                |
| CLI with only `--proxy-pac-url`                                                            | Installs without a proxy: the CLI never downloads the PAC file.                                                                                                                                                                                                      |
| App through `squid-open`, with a bypass entry                                              | The extension host reaches `origin.lab.test` through `squid-open`, a host in `http.noProxy` goes direct, and the Marketplace search goes through `squid-open`.                                                                                                       |
| App through `mitmproxy`, Strict SSL on                                                     | The extension host request and the Marketplace search fail on the certificate.                                                                                                                                                                                       |
| App through `mitmproxy`, Strict SSL off                                                    | The same failures.                                                                                                                                                                                                                                                   |
| App with only `--proxy-pac-url`                                                            | VS Code downloads the PAC file, the extension host reaches `origin.lab.test` through `squid-open`, and the Marketplace search gets `407` from `squid-auth`. On Linux, the window's Marketplace requests succeed without a proxy instead, and `squid-auth` sees none. |
| App with a `socks5h://` proxy                                                              | The extension host reaches `origin.lab.test` through `socks5`, while every Marketplace request from the window fails with `ERR_NO_SUPPORTED_PROXIES`.                                                                                                                |
| SSH window with `http.proxy` set only locally                                              | Check 1 in [Remote windows](#remote-windows).                                                                                                                                                                                                                        |
| SSH window, Global write while the remote file holds a stale `http.proxy`                  | Check 2 in [Remote windows](#remote-windows).                                                                                                                                                                                                                        |
| SSH window, `http.useLocalProxyConfiguration` changed while open                           | Check 3 in [Remote windows](#remote-windows).                                                                                                                                                                                                                        |
| Two SSH windows, the second writes the remote `http.proxy`                                 | Check 4 in [Remote windows](#remote-windows).                                                                                                                                                                                                                        |
| SSH window whose remote settings pin an empty `http.proxy`                                 | Check 6 in [Remote windows](#remote-windows).                                                                                                                                                                                                                        |
| SSH window, `http.useLocalProxyConfiguration` removed while open                           | Check 7 in [Remote windows](#remote-windows).                                                                                                                                                                                                                        |
| SSH window, `http.proxy` written right after `http.useLocalProxyConfiguration` turns false | Check 8 in [Remote windows](#remote-windows).                                                                                                                                                                                                                        |
| Proxy Toggler in an SSH window                                                             | See [Proxy Toggler in an SSH window](#proxy-toggler-in-an-ssh-window).                                                                                                                                                                                               |
| App, Off: settings removed while running, with `--proxy-pac-url`                           | Before Off, both go through `squid-open`. After, the extension host cannot resolve `origin.lab.test` (direct), and `squid-auth` sees no Marketplace request.                                                                                                         |
| App, Off: settings removed while running, with `HTTP(S)_PROXY`                             | After Off, the extension host gets `407` from `squid-auth`, the proxy the variables name, and so does the Marketplace search.                                                                                                                                        |
| App, Off: Direct candidate at start-up                                                     | With `--proxy-pac-url`, the extension host goes direct and `squid-auth` sees no Marketplace request.                                                                                                                                                                 |
| App, Off: Direct candidate while running                                                   | The same, after the candidate replaces `squid-open` while VS Code runs.                                                                                                                                                                                              |
| Test Connection: an `https://` target through `squid-open`                                 | Passes: the tunnel opens and the Marketplace answers.                                                                                                                                                                                                                |
| Test Connection: an `http://` target through `squid-open`                                  | Passes: the origin answers 200.                                                                                                                                                                                                                                      |
| Test Connection: an `http://` target that `squid-open` cannot resolve                      | Warns that the proxy may have sent its 503.                                                                                                                                                                                                                          |
| Test Connection: `squid-auth` asks for a sign-in                                           | Warns about the 407.                                                                                                                                                                                                                                                 |
| Test Connection: no proxy listening                                                        | Fails: the connection was refused.                                                                                                                                                                                                                                   |
| Test Connection: `squid-open` refuses the tunnel                                           | Fails with the 403 that Squid sends for a port outside its SSL ports.                                                                                                                                                                                                |
| Test Connection: the origin's self-signed certificate                                      | Warns that the origin's certificate is self-signed.                                                                                                                                                                                                                  |
| Test Connection: a certificate that does not name the host                                 | Fails: the origin's certificate is for `origin.lab.test`, not `origin`.                                                                                                                                                                                              |
| Test Connection: `mitmproxy`'s certificate                                                 | Warns that the certificate comes from mitmproxy's authority.                                                                                                                                                                                                         |
| Test Connection: a SOCKS proxy                                                             | Skipped: the test covers HTTP and HTTPS proxies only.                                                                                                                                                                                                                |

A failing check means that VS Code no longer behaves as recorded here, or that the lab is broken;
find out which, then update the tables. The **Proxy lab** workflow
([`.github/workflows/proxy-lab.yml`](.github/workflows/proxy-lab.yml)) brings the lab up and runs
the probe on Ubuntu when started by hand from the Actions tab. It never runs on pull requests, so it
cannot become a required check: GitHub's macOS runners have no Docker, and its Windows runners
cannot run Linux containers. On 21 October 2026 it passed all 54 checks, the SSH ones
included, on VS Code 1.97.0 and 1.143.0
([run 39630452394](https://github.com/bluecloud-dev/proxy-toggler/actions/runs/39630452394)).

### Remote windows

These checks show how VS Code applies the proxy settings in a remote window, and the last one how
Proxy Toggler manages them there. Each SSH check starts a new VS Code server on the lab's `ssh-host`, opens
a Remote-SSH window on the folder `/home/lab/window-1`, and runs `tests/proxy-lab/remote.ts` in the
window's remote extension host. The runner copies that probe to the SSH host with a manifest of
Proxy Toggler's extension kind, `workspace`. The probe follows the folder's `plan.json`: it reads
`http.proxy` with `get()` and `inspect()`, writes settings with `ConfigurationTarget.Global`, waits
for `onDidChangeConfiguration`, and requests `origin.lab.test`. Afterwards the runner reads the
local `settings.json` and the SSH host's `/home/lab/.vscode-server/data/Machine/settings.json`.

The local proxy is `http://127.0.0.1:3128`: `squid-open` for the local window, but nothing on the
SSH host. A remote request that takes it fails with "Failed to establish a socket connection to
proxies: PROXY 127.0.0.1:3128". The remote proxy is `http://squid-open:3128`, which only the SSH
host reaches. A remote request without a proxy fails with `ENOTFOUND`.

Measured with `npm run proxy-lab:probe` on macOS (arm64), Docker Desktop, and the Debian 13.7 SSH
host, in October 2026:

| #   | Check                                                                            | Setup                                                                                                                                                              | VS Code 1.97.0 with Remote-SSH 0.120.0                                                                                                                                                                                                                                                                                                                                                                            | VS Code 1.142.0 with Remote-SSH 0.128.0                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Does an SSH window see the local proxy?                                          | `http.proxy` only in the local user settings. `http.useLocalProxyConfiguration` keeps its SSH default, `false`.                                                    | **At start-up, yes; after a local change, no.** In all 17 windows, `get('proxy')` returned the local value at start-up, `inspect('proxy')` showed it as `globalLocalValue` and `globalValue`, and the remote extension host sent its requests to `127.0.0.1:3128` on the SSH host. When the local `http.proxy` changed, `onDidChangeConfiguration` fired, `get('proxy')` returned `""`, and requests went direct. | **Usually at start-up; after a local change, no.** The same as on 1.97.0 in 12 of 17 windows. In the 5 windows whose connection installed the VS Code server, `get('proxy')` returned `""` from the start and requests went direct. |
| 2   | Stale key in the remote file                                                     | The SSH host's `Machine/settings.json` holds `http.useLocalProxyConfiguration: true` and an `http.proxy`. The local settings hold another one.                     | **The write lands in the remote file.** `update('proxy', value, ConfigurationTarget.Global)` resolves and fires an `http.proxy` change event, but it replaces the stale value in `Machine/settings.json`. The local `settings.json` is unchanged, and the value in effect stays the local one.                                                                                                                    | The same                                                                                                                                                                                                                            |
| 3   | Changing `http.useLocalProxyConfiguration`                                       | The local and the remote `http.proxy` differ. The window is open.                                                                                                  | **Applies without a reload.** Writing `true` with `Global` lands in `Machine/settings.json`, fires an `http.proxy` change event, and switches the remote extension host to the local value, for `get()` and for requests. Writing `false` switches it back the same way.                                                                                                                                          | The same                                                                                                                                                                                                                            |
| 4   | Change events across windows                                                     | Two windows on the SSH host, each in its own VS Code profile. One writes `http.proxy` with `Global`.                                                               | **The event fires.** The write lands in `Machine/settings.json`, and the other window's remote extension host gets `onDidChangeConfiguration` for `http.proxy`, then reads and uses the new value.                                                                                                                                                                                                                | The same                                                                                                                                                                                                                            |
| 5   | `http.proxy` with `socks5h://`                                                   | A local window.                                                                                                                                                    | **`ERR_NO_SUPPORTED_PROXIES`, not direct.** Chromium's net log shows every Marketplace request from the window failing with that error, from an empty proxy list. The extension host reads the scheme as SOCKS5 and reaches `origin.lab.test` through `socks5`.                                                                                                                                                   | The same                                                                                                                                                                                                                            |
| 6   | An empty `http.proxy` in the remote file                                         | The SSH host's `Machine/settings.json` holds `http.proxy: ""`. The local settings hold `http://127.0.0.1:3128`.                                                    | **The empty value pins the remote side from start-up.** In all 5 windows, `get('proxy')` returned `""` at start-up, `inspect('proxy')` showed `""` as `globalRemoteValue` and `globalValue` and the local value as `globalLocalValue`, and requests went direct.                                                                                                                                                  | **The same** in all 5 windows, except that `inspect('proxy')` showed no `globalLocalValue`.                                                                                                                                         |
| 7   | Removing `http.useLocalProxyConfiguration`                                       | The SSH host's `Machine/settings.json` holds `http.useLocalProxyConfiguration: true` and an `http.proxy`. The local settings hold another one. The window is open. | **Applies without a reload.** Removing the setting with `Global` removes it from `Machine/settings.json`, fires an `http.proxy` change event, and switches the remote extension host to its default over SSH, the remote value, for `get()` and for requests.                                                                                                                                                     | The same                                                                                                                                                                                                                            |
| 8   | Writing `http.proxy` right after `http.useLocalProxyConfiguration` turns `false` | The SSH host's `Machine/settings.json` holds `http.useLocalProxyConfiguration: true`. The local settings hold an `http.proxy`. The window is open.                 | **The write lands in the remote file.** Once the write of `false` resolves, a `Global` write of `http.proxy: ""` goes to `Machine/settings.json`, not to the local `settings.json`, and requests go direct. Measured in 3 windows.                                                                                                                                                                                | The same, in 3 windows                                                                                                                                                                                                              |

- Result 1 contradicts a reading of VS Code's source, which has `http.*` machine-scoped in SSH
  windows and so predicted that the local value stays hidden. It looks like a race at start-up:
  probably the window reads the local settings before it learns that it is remote and narrows
  `http.*`, and filters them only when the local file changes again. Whatever the cause, it matches
  reports of extensions on an SSH host that try a local `127.0.0.1` proxy
  ([microsoft/vscode#236242](https://github.com/microsoft/vscode/issues/236242)). The probe accepts
  either start-up outcome, but not a local value that survives a local change.
- Check 4 runs the two windows in two VS Code processes, because the probe starts one window per
  process. Each window watches the remote file over its own connection, as two windows of one VS
  Code do.
- Result 7 is what **Use This Computer's Proxy Again** relies on: it removes the setting, so a WSL
  or container remote returns to its default, this computer's settings, without a reload.
- Result 8 is what **Use a Separate Proxy for This Remote** relies on: it pins the remote machine
  with `http.proxy: ""` right after the switch, so the write must not land in this computer's
  settings.
- Proxy Toggler relies on result 6 in a window that manages a remote machine's own settings:
  turning the proxy off there writes `http.proxy: ""` instead of removing the key, so the remote
  file always holds a value, and it wins over the local value that result 1 hands over.
- Result 1 does not decide checks 2 to 4. Where they expect the remote value, the SSH host's file
  holds one, and it takes precedence over the local value, which `inspect()` still shows as
  `globalLocalValue` in check 3.

#### Proxy Toggler in an SSH window

The check "Proxy Toggler in an SSH window" copies Proxy Toggler's build to the SSH host and loads it
beside the probe. The local settings hold `http.proxy: http://127.0.0.1:3128` and two profiles,
"Lab remote" (`http://squid-open:3128`) and "Lab local" (the local proxy), and the SSH host's
settings hold no proxy. The plan switches to "Lab remote" with `proxyToggler.switchProfile`, then
turns the proxy off with `proxyToggler.disable`, and the probe reads the toggle's text through the
extension's exports.

Measured in October 2026, on VS Code 1.97.0 and 1.143.0:

- At start-up, the toggle showed `Proxy (<host>): OFF`. On 1.97.0, VS Code handed the remote side
  the local proxy, as in check 1, and the toggle still showed off, because Proxy Toggler trusts
  only the SSH host's own settings.
- Switching wrote the profile to the SSH host's `Machine/settings.json` only, the local
  `settings.json` kept `http://127.0.0.1:3128`, and the request went through `squid-open`.
- Turning the proxy off wrote `http.proxy: ""` there, and the request went direct.
- The record, off with "Lab remote" current, was in `proxyToggler.state.json` in the extension's global storage
  on the SSH host.

#### WSL (by hand, on Windows)

WSL windows cannot run in the lab, so checks 1 to 4 need a Windows machine with WSL 2 in its
default networking mode, NAT. Run them on VS Code 1.97.0, from its portable zip, and on stable,
both with the WSL extension. WSL starts its VS Code server with the local proxy configuration, so
`http.useLocalProxyConfiguration` defaults to `true` there.

Prepare once: run `npm ci` and `npx tsc -p .` in the repository on Windows. In the WSL
distribution, create `~/probe` with `out/tests/proxy-lab/remote.js` and `requests.js` from the
repository and this `package.json`:

```json
{
  "name": "proxy-lab-remote-probe",
  "publisher": "proxy-toggler-tests",
  "version": "0.0.0",
  "engines": { "vscode": "^1.97.0" },
  "main": "./remote.js"
}
```

The checks need no proxy: local `http.proxy` is `http://127.0.0.1:3128` and the WSL one is
`http://127.0.0.2:3128`, and a request that takes either fails with an error naming it. For each
check:

1. Run `pkill -f .vscode-server` in WSL, so that a new VS Code server starts.
2. Write the check's `plan` from `tests/run-proxy-lab-probe.ts` to `~/window-1/plan.json`, and the
   WSL machine settings below to `~/.vscode-server/data/Machine/settings.json`.
3. Create a profile folder whose `User\settings.json` holds the local `http.proxy`, then start VS
   Code from a Command Prompt, with your distribution and user name:

   ```text
   code --user-data-dir <profile> --remote wsl+<distro> --folder-uri vscode-remote://wsl+<distro>/home/<user>/window-1 --extensionDevelopmentPath=vscode-remote://wsl+<distro>/home/<user>/probe --extensionTestsPath=vscode-remote://wsl+<distro>/home/<user>/probe/remote.js
   ```

4. When the window closes, read `~/window-1/results.json` and both settings files, and record
   the result here.

- [ ] Check 1. No WSL machine settings. Once `~/window-1/ready` appears, change `http.proxy` in the
      profile's `settings.json`. Source reading predicts that the local value stays visible after
      the change, because `http.*` are application-scoped, and that requests fail on WSL's own
      `127.0.0.1`.
- [ ] Check 2. WSL machine settings: `{ "http.proxy": "http://127.0.0.2:3128" }`, which WSL's
      default scope ignores. Source reading predicts the same result as in SSH: the write replaces
      the WSL value, and the local value stays in effect.
- [ ] Check 3. WSL machine settings: `{ "http.proxy": "http://127.0.0.2:3128" }`. Use the SSH plan
      with `false` and `true` swapped. Source reading predicts that `false` switches the remote
      extension host to `127.0.0.2` without a reload, and `true` back.
- [ ] Check 4. WSL machine settings: `{ "http.useLocalProxyConfiguration": false }`, so that the
      write goes to the WSL file. Write the `secondWindow` plan to `~/window-2/plan.json`. Once
      `~/window-1/ready` appears, start a second window the same way, with its own profile and
      `window-2`. Source reading predicts that the event fires.

Not run for v0.2.0, and the procedure itself is untried: the lab has no Windows machine. Proxy
Toggler's WSL behavior rests on the source readings above until someone runs these checks.
