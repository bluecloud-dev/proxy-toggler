# Testing

## Layers

| Layer       | Location             | Runs in                                                        | Command                                    |
| ----------- | -------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| Unit        | `tests/unit/`        | Node, with Mocha and ts-node, against fakes                    | `npm test`                                 |
| Security    | `tests/security/`    | Same as unit                                                   | `npm test`                                 |
| Integration | `tests/integration/` | A real VS Code Extension Development Host, on two versions     | `npm run test:integration`                 |
| Packaged    | `tests/packaged/`    | A real VS Code with the VSIX installed, in an untrusted folder | `npm run package && npm run test:packaged` |

`npm run check` runs the format check, lint, the unused-code check, the type check, and the unit
and security tests with coverage. CI runs the same steps, then the integration tests, then the
packaged tests on the VSIX it built. On Windows and macOS, CI runs the integration and packaged
tests too, because credential storage and settings files differ by operating system.

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
- To test what happens while a notification is open, return a promise from the `answer` option
  and settle it after the action under test. To make setting writes fail, pass `failKey` (every
  write to one setting) or `failWhen` (the writes it matches) to `createHttpSettings`.
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
