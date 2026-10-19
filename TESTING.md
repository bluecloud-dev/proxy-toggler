# Testing

## Layers

| Layer       | Location             | Runs in                                                        | Command                                    |
| ----------- | -------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| Unit        | `tests/unit/`        | Node, with Mocha and ts-node, against fakes                    | `npm test`                                 |
| Security    | `tests/security/`    | Same as unit                                                   | `npm test`                                 |
| Integration | `tests/integration/` | A real VS Code Extension Development Host, on two versions     | `npm run test:integration`                 |
| Packaged    | `tests/packaged/`    | A real VS Code with the VSIX installed, in an untrusted folder | `npm run package && npm run test:packaged` |

`npm run check` runs the format check, lint, the unused-code check, the type check, and the unit
and security tests with coverage. CI runs the same steps, then the integration tests, the
no-telemetry guard, the high-severity `npm audit`, and the packaged tests on the VSIX it built. On
Windows and macOS, CI runs the integration and packaged tests too, because credential storage and
settings files differ by operating system.

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

- With the proxy enabled, a request for `http://origin.invalid/hello` reaches the proxy, which
  answers it. After **Disable**, the same request goes direct, fails with `ENOTFOUND`, and the
  proxy sees nothing new.
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
- Keep one test file per source module, named after the module, and name each test after the
  behavior it pins.
- Security tests must keep proving that credentials never reach `globalState`, messages, or logs.

## Manual QA checklist

Run these in the Extension Development Host (F5) before a release, or after changes to the flows
they cover.

- [ ] Configure without credentials (empty username): the configuration is saved, the "Enable now?"
      prompt appears, and **Enable** turns the proxy on.
- [ ] Configure with a username and password, reload the window, run Configure again: **Keep
      existing credentials** is offered and the password is never shown.
- [ ] Replace, then remove, stored credentials through Configure.
- [ ] Enable: user settings contain `http.proxy`, `http.proxyStrictSSL`, and an `http.noProxy`
      array; the status bar shows "Proxy: ON"; the Command Palette offers Disable but not Enable.
- [ ] Disable: the three settings are removed and the status bar shows "Proxy: OFF".
- [ ] Toggle from the status bar item, with `proxyToggler.confirmBeforeToggle` both off and on.
- [ ] Drift: edit `http.proxy` by hand, reload, run any command, and accept **Sync**.
- [ ] Policy or read-only settings: when a setting cannot be written, the error offers **Open
      Settings**.
- [ ] Keychain unavailable or locked (for example a locked macOS login keychain): the keychain
      message appears and the error is in **Output → Proxy Toggler**.
- [ ] The **Proxy Toggler** output channel never contains a username or password.
- [ ] A screen reader announces the status bar item's state ("Proxy status: enabled").
