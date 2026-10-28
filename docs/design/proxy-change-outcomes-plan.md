# Proxy change outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every proxy change reports what it did through one module, so the eight call sites stop
rebuilding "change, refresh, say it, explain the error" and stop announcing changes that did not
happen.

**Architecture:** `ProxyManager`'s changes return outcome values from a new
`src/core/proxy-outcome.ts` for expected races; failed setting writes keep throwing. A new
`src/commands/proxy-change.ts` exposes one function, `change((manager) => …)`, that runs a change,
refreshes the UI and reports the outcome or the failed write. Commands keep only `ProxyManager`
queries, so the compiler routes every change through `change`.

**Tech Stack:** TypeScript 5 (strict), VS Code extension API `^1.97.0`, mocha + ts-node, nyc,
ESLint, Prettier, knip.

**Spec:** [proxy-change-outcomes.md](proxy-change-outcomes.md)

## Global Constraints

- Engine range stays `"vscode": "^1.97.0"`.
- `src/core` imports nothing from `src/commands`, `src/vscode` or the composition root; only
  `src/extension.ts` imports `vscode` at runtime (enforced by `eslint.config.mjs`).
- Dependencies are explicit parameters; no IoC container.
- Comments carry only the "why"; names carry the "what". Match the surrounding comment density.
- No persisted key or shape changes (ARCHITECTURE.md, "Persisted data", is a compatibility
  contract).
- Exact copy, verbatim from the spec:
  - `Proxy Toggler turned on <name>.` · `Proxy Toggler turned off <name>.` ·
    `Proxy Toggler turned the proxy off.` · `Proxy Toggler deleted <name>.`
  - `Renamed <from> to <to>. Keybindings that switch to "<from>" by name stop working.`
  - `No proxy profile is named "<name>". The list may have changed in another window or through Settings Sync.`
  - `<name> was already deleted, in another window or through Settings Sync.`
  - `No proxy configuration found. Please configure proxy settings first.`, button `Configure Now`
  - Buttons `Open Settings` and `Turn Proxy Off`; action ids stay `configure`, `openSettings`,
    `disableProxy`.
- `npm run check` exits 0 at the end of every task.
- Commits: `type: plain sentence` subject, a body that says why, and the line
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push.

## Review Focus

1. Two overlapping toggles (a double click on the status bar) each get their own outcome, in
   order, and the settings end where the second left them.
2. A profile renamed in another window while Edit is open is `gone` on save, not `nameTaken`.
3. An edit that renames the profile, saves, and then fails to apply shows only the error: no
   rename warning (ADR 0004).
4. Deleting the current profile while on, when turning off fails, keeps the profile and offers no
   **Turn Proxy Off**.
5. A cause chain that loops back on itself does not hang `failedSettingWrite`.

---

### Task 1: Record the decisions

**Files:**

- Modify: `docs/adr/0004-focused-window-acts-on-outside-changes.md:22`
- Modify: `GLOSSARY.md` (Proxy state section, after **Outside change**)
- Add: `docs/design/architecture-research.md`, `docs/design/proxy-change-outcomes.md`,
  `docs/design/proxy-change-outcomes-plan.md`

**Interfaces:**

- Produces: the term **Proxy change**, used by Tasks 3–6 in comments and docs.

- [ ] **Step 1: Amend ADR 0004's consequence line** to read exactly:
      `- Notification buttons check the state again when clicked and do nothing, and say so, if it has changed.`
- [ ] **Step 2: Add the glossary entry** after **Outside change**:

```markdown
**Proxy change**:
A change Proxy Toggler makes to the profiles, the record or VS Code's proxy settings because the
user asked for it in this window.
_Avoid_: own change, user action
```

- [ ] **Step 3: Verify formatting.** Run: `npx prettier --check GLOSSARY.md docs/`
      Expected: `All matched files use Prettier code style!`
- [ ] **Step 4: Commit** `docs: record the proxy change outcome design`

### Task 2: Errors carry their own user message

**Files:**

- Modify: `src/core/proxy-settings-writer.ts` (add `failedSettingWrite`)
- Modify: `src/vscode/error-reporting.ts:1-6,43-47`
- Test: `tests/unit/proxy-settings-writer.test.ts`, `tests/unit/error-reporting.test.ts`

**Interfaces:**

- Produces: `failedSettingWrite(error: unknown): ConfigurationError | undefined` and
  `userMessageOf(error: unknown): string | undefined`.

- [ ] **Step 1: Write the failing tests.**
  - `proxy-settings-writer.test.ts`, `it('finds the failed setting write behind wrapping errors')`:
    with `const failure = new ConfigurationError('enable', 'proxy')`, assert
    `failedSettingWrite(failure) === failure`,
    `failedSettingWrite(new ProfileApplyError('Work', failure)) === failure`,
    `failedSettingWrite(new Error('a', { cause: new Error('b', { cause: failure }) })) === failure`,
    `failedSettingWrite(new Error('plain')) === undefined`, `failedSettingWrite('text') === undefined`.
  - Same file, `it('stops at a cause chain that loops')`: `const loop = new Error('a');
loop.cause = loop;` then `assert.equal(failedSettingWrite(loop), undefined)`.
  - `error-reporting.test.ts`, `it("shows an error's own user message, or the command's fallback")`:
    register a command through `createCommandRegistrar(vscode, logger, recorder)` over
    `createFakeVscode()` and `createNotificationRecorder()`. A handler throwing
    `Object.assign(new Error('x'), { toUserMessage: () => 'Explained.' })` records the error
    `Explained.`; one throwing `new Error('x')` records the fallback passed at registration.
- [ ] **Step 2: Run them to see them fail.** Run: `npx mocha tests/unit/proxy-settings-writer.test.ts tests/unit/error-reporting.test.ts`
      Expected: FAIL, `failedSettingWrite` is not exported.
- [ ] **Step 3: Implement `failedSettingWrite`** in `proxy-settings-writer.ts`: follow `cause`,
      remembering visited errors in a `Set` so a loop ends.
- [ ] **Step 4: Implement `userMessageOf`** in `error-reporting.ts` as a structural check for a
      `toUserMessage(): string` method. Make `userMessageFor` return
      `userMessageOf(error) ?? failureMessage`, and remove the imports of `ProfileApplyError` and
      `ConfigurationError`. `error-reporting.ts` then imports nothing from `src/core`.
- [ ] **Step 5: Run the tests.** Run: `npm run check`
      Expected: exit 0.
- [ ] **Step 6: Commit** `refactor: let errors carry their own user message`

### Task 3: The outcomes and the proxy change module

**Files:**

- Create: `src/core/proxy-outcome.ts`
- Create: `src/commands/proxy-change.ts`
- Test: `tests/unit/proxy-change.test.ts`

**Interfaces:**

- Consumes: `failedSettingWrite`, `userMessageOf` (Task 2); `COMMANDS` from
  `src/commands/command-ids.ts`; `Notifier`; `ProfileApplyError`.
- Produces, in `src/core/proxy-outcome.ts`:

```ts
export type On = { kind: 'on'; profile: Profile };
export type Off = { kind: 'off'; profile?: Profile };
export type Saved = { kind: 'saved'; profile: Profile; renamedFrom?: string; isOn: boolean };
export type Deleted = { kind: 'deleted'; name: string };
export type Gone = { kind: 'gone'; name: string; change: 'switch' | 'save' | 'delete' };
export type NotConfigured = { kind: 'notConfigured' };
export type NameTaken = { kind: 'nameTaken'; name: string; reason: string };
export type ProxyOutcome = On | Off | Saved | Deleted | Gone | NotConfigured | NameTaken;
```

- Produces, in `src/commands/proxy-change.ts`: `ProxyChanger`, `Reported<O>`, `ProxyChange` and
  `createProxyChange(vscodeApi, proxyManager, notifier, refreshUi)`, exactly as in the spec's
  "The proxy change module".

- [ ] **Step 1: Write the failing tests** in `tests/unit/proxy-change.test.ts`. Build the
      module over `createFakeVscode({ settings })`, a real `ProxyManager` over `tests/support/fakes.ts`
      (the passed functions ignore it), `createNotificationRecorder(choose)` and a `refreshUi` spy that
      pushes `recorder.notifications.length` to `seenAtRefresh`. `inform` never calls `choose`, so the
      count is the order check.
  - `it('refreshes before it says anything, even when the change fails')`: with toasts on, an
    `on` outcome gives `seenAtRefresh` `[0]` and one notification. A thrown
    `new ConfigurationError('enable', 'proxy')` gives `[0]` and one notification. A thrown
    `new Error('boom')` rejects with `/boom/`, with `seenAtRefresh` `[0]` and no notification.
  - One `it` per row, with `proxyToggler.showSwitchNotifications` both `true` and `false`. Each
    asserts the recorded `[kind, message]` pairs. Gated rows record nothing when it is `false`.

    | Outcome                               | Kind      | Message                                                                                                   | Gated |
    | ------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- | ----- |
    | `on` Work                             | `success` | `Proxy Toggler turned on Work.`                                                                           | yes   |
    | `off` Work                            | `success` | `Proxy Toggler turned off Work.`                                                                          | yes   |
    | `off` without a profile               | `success` | `Proxy Toggler turned the proxy off.`                                                                     | yes   |
    | `deleted` Work                        | `success` | `Proxy Toggler deleted Work.`                                                                             | yes   |
    | `saved` Office, `renamedFrom: 'Work'` | `warning` | `Renamed Work to Office. Keybindings that switch to "Work" by name stop working.`                         | no    |
    | `saved` without `renamedFrom`         | —         | nothing                                                                                                   | —     |
    | `nameTaken`                           | —         | nothing                                                                                                   | —     |
    | `gone` Work, change `'delete'`        | `warning` | `Work was already deleted, in another window or through Settings Sync.`                                   | no    |
    | `gone` Work, change `'switch'`        | `warning` | `No proxy profile is named "Work". The list may have changed in another window or through Settings Sync.` | no    |
    | `notConfigured`                       | `warning` | `No proxy configuration found. Please configure proxy settings first.`                                    | no    |

  - `it('returns the outcome it was given')`: `assert.equal(await change(() => Promise.resolve(outcome)), outcome)`.
  - `it('runs Configure Now when chosen')`: answering `configure` records
    `{ command: 'proxyToggler.configure', args: [] }` in `vscode.executedCommands`.
  - `it('offers Turn Proxy Off only after a failed turn-on')`: a failed `'enable'` write records
    action titles `['Open Settings', 'Turn Proxy Off']`; a failed `'disable'` write records
    `['Open Settings']`. Both resolve `{ kind: 'writeFailed' }`.
  - `it('explains a saved edit that could not be applied in its own words')`: a thrown
    `new ProfileApplyError('Work', new ConfigurationError('enable', 'proxy'))` records that error's
    `toUserMessage()` with both buttons.
  - `it('opens the failed setting, or turns the proxy off, when asked')`: answering `openSettings`
    records `{ command: 'workbench.action.openSettings', args: ['http.proxy'] }`; answering
    `disableProxy` records `{ command: 'proxyToggler.disable', args: [] }`.
  - `it('rethrows a saved-edit error whose cause is not a failed setting write')`:
    `new ProfileApplyError('Work', new Error('disk'))` rejects with `ProfileApplyError` and records
    no notification.
- [ ] **Step 2: Run them to see them fail.** Run: `npx mocha tests/unit/proxy-change.test.ts`
      Expected: FAIL, cannot find module `../../src/commands/proxy-change`.
- [ ] **Step 3: Add `src/core/proxy-outcome.ts`** with the types above.
- [ ] **Step 4: Implement `createProxyChange`.** On a thrown error: refresh, then hand anything
      that `failedSettingWrite` cannot explain back to the caller. Report with an exhaustive `switch`
      over `kind`, ending in a `never` check. Messages without buttons go through `inform`. The
      **Configure Now** warning and the failed-write error wait for the answer and run the chosen
      command. The failed-write error's text is `userMessageOf(error)` of the thrown error.
- [ ] **Step 5: Run the checks.** Run: `npm run check`
      Expected: exit 0. If `knip` reports `proxy-change.ts` unused, fold this task's commit into
      Task 4's.
- [ ] **Step 6: Commit** `feat: add one module that reports what a proxy change did`

### Task 4: Turning on, off and switching report through the module

**Files:**

- Modify: `src/core/proxy-manager.ts` (`enableProxy`, `disableProxy`, `toggleProxy`, `switchTo`,
  private `enable`)
- Modify: `src/proxy-toggler.ts:177-202`, `src/vscode/error-reporting.ts` (`RegisterCommand`)
- Modify: `src/commands/toggle-proxy.ts`, `src/commands/switcher.ts`,
  `src/commands/add-profile.ts:106-118`
- Delete: `src/commands/enable-proxy.ts`, `src/commands/disable-proxy.ts`
- Test: `tests/unit/proxy-manager.test.ts`, `tests/unit/switcher.test.ts`,
  `tests/unit/add-profile.test.ts`; replace `tests/unit/proxy-toggle-commands.test.ts` with
  `tests/unit/toggle-proxy.test.ts`

**Interfaces:**

- Consumes: `ProxyChange`, `createProxyChange` and the outcome types (Task 3).
- Produces:
  - `enableProxy(): Promise<On | NotConfigured>`, `disableProxy(): Promise<Off>`,
    `toggleProxy(): Promise<On | Off | NotConfigured>`, `switchTo(name): Promise<On | Gone>`.
  - `toggleProxyCommand(vscodeApi, proxyManager: Pick<ProxyManager, 'getState'>, notifier, change)`.
  - `switchProfileCommand(vscodeApi, proxyManager, notifier, refreshUi, change, name?)` and
    `addProfileCommand(vscodeApi, proxyManager, notifier, refreshUi, change, options?)`. Both
    signatures are transitional: Task 5 drops `refreshUi`. Edit and Delete do not change yet.
  - `RegisterCommand`'s `run` returns `Promise<unknown>`.

- [ ] **Step 1: Write the failing tests.**
  - `proxy-manager.test.ts`: `'is not configured without profiles and refuses to turn on'`
    asserts `deepEqual(await proxyManager.toggleProxy(), { kind: 'notConfigured' })`, and the same
    for `enableProxy()`. `'switches to a named profile…'` asserts `{ kind: 'on', profile: HOME }`
    and `deepEqual(await proxyManager.switchTo('Office'), { kind: 'gone', name: 'Office', change: 'switch' })`.
    New `it('reports off with the current profile, or none when not configured')`.
  - New `it('reports each of two overlapping toggles once, in order')` (Review Focus 1):
    `Promise.all([toggleProxy(), toggleProxy()])` from off gives kinds `['on', 'off']`, and
    `httpSettings.current.proxy` ends `undefined`.
  - `tests/unit/toggle-proxy.test.ts` keeps the two confirmation cases from
    `proxy-toggle-commands.test.ts`. Rewrite them to run `COMMANDS.toggle` through
    `createProxyToggler` over `createFakeVscode`, with `proxyToggler.confirmBeforeToggle: true`.
    Cancel leaves `http.proxy` as it was; Turn Off clears it.
  - `switcher.test.ts:144`: rename to `'warns and shows the switcher when a keybinding names no profile'`.
    It expects
    `[['warning', 'No proxy profile is named "Office". The list may have changed in another window or through Settings Sync.']]`
    and one quick pick.
  - `add-profile.test.ts`, new `it('says the profile is gone when Turn On finds it removed')`:
    the answer to the save prompt removes the profile through `vscode.changeSettings`, then
    clicks Turn On. Expect the general `gone` warning, and `http.proxy` unchanged.
- [ ] **Step 2: Run them to see them fail.** Run: `npx mocha tests/unit/proxy-manager.test.ts tests/unit/switcher.test.ts tests/unit/add-profile.test.ts tests/unit/toggle-proxy.test.ts`
      Expected: FAIL on the new assertions.
- [ ] **Step 3: Return outcomes from the four `ProxyManager` methods.** Where no profile is
      current, `enable` returns `{ kind: 'notConfigured' }` instead of throwing, and `toggleProxy` does
      the same when Not configured. `off` carries `getState().currentProfile` after the turn-off.
- [ ] **Step 4: Wire the module.**
  - **Composition root:** create `change` once. Register `COMMANDS.enable` and `COMMANDS.disable`
    as `() => change((manager) => manager.enableProxy())` and its counterpart, and pass `change`
    to toggle, the switcher and Add.
  - **Remove:** delete the two command files and `proxy-toggle-commands.test.ts`.
  - **Toggle:** keep the confirm prompt, call `change`, and drop the up-front configure offer.
  - **Switcher:** the profile pick, the toggle/re-apply/clear items and the keybinding path call
    `change`. The keybinding path opens the switcher only when the result's `kind` is `'gone'`.
    `SwitcherManager` drops `enableProxy`, `disableProxy` and `switchTo`.
  - **Add:** Turn On calls `change((manager) => manager.switchTo(profile.name))`.
- [ ] **Step 5: Run the checks.** Run: `npm run check`
      Expected: exit 0.
- [ ] **Step 6: Commit** `refactor: report turning on, off and switching through one module`.
      The body names behaviour changes 1–3 from the spec.

### Task 5: Adding, editing and deleting report through the module

**Files:**

- Modify: `src/core/proxy-manager.ts` (`addProfile`, `updateProfile`, `deleteProfile`)
- Modify: `src/commands/add-profile.ts`, `src/commands/edit-profile.ts`,
  `src/commands/delete-profile.ts`, `src/commands/switcher.ts`, `src/proxy-toggler.ts`
- Modify: `src/vscode/quick-input.ts:32-40` (validate a non-empty opening value)
- Delete: `src/commands/proxy-feedback.ts`
- Test: `tests/unit/proxy-manager.test.ts`, `tests/unit/edit-profile.test.ts`,
  `tests/unit/add-profile.test.ts`; `tests/unit/remote-windows.test.ts` runs unchanged

**Interfaces:**

- Consumes: Task 3's outcome types and `ProxyChange`; Task 4's `switchProfileCommand`.
- Produces:
  - `addProfile(profile): Promise<Saved | NameTaken>`,
    `updateProfile(originalName, profile): Promise<Saved | Gone | NameTaken>`,
    `deleteProfile(name): Promise<Deleted | Gone>`.
  - Commands take `(vscodeApi, proxyManager: Pick<ProxyManager, …queries>, notifier, change, …)`,
    with no `refreshUi`.
  - `switchProfileCommand(vscodeApi, proxyManager, notifier, change, name?)` and
    `addProfileCommand(vscodeApi, proxyManager, notifier, change, options?)`.
  - `askForProfile(vscodeApi, takenNames, proxyUrl = '', name?: string)`: when given a name, it
    opens at the name step with that name.
  - `editField(vscodeApi, profile, field, takenNames, value?: string)`: `value` pre-fills the
    name field.

- [ ] **Step 1: Write the failing tests.**
  - `proxy-manager.test.ts`:
    - `'refuses a name an entry already holds…'` asserts `deepEqual(await proxyManager.addProfile(OFFICE), { kind: 'nameTaken', name: OFFICE.name, reason: \`"${OFFICE.name}" is already used in proxyToggler.profiles.\` })`.
An invalid URL still rejects with `ValidationError`, and nothing is written.
    - `'refuses an edit of a profile that is gone…'` asserts `{ kind: 'gone', name: 'Work', change: 'save' }`.
    - New `it('reports a rename, and whether the saved profile is on')`.
    - New `it('reports a name another entry took during an edit')`.
    - New `it('reports a delete, or a profile already gone, writing nothing then')`. The second
      call leaves `profilesSetting.writes` unchanged.
    - Convert every `'on'` or `'saved'` result of `addProfile` to `{ kind: 'saved', profile, isOn }`.
    - New `it('keeps the current profile when turning it off fails during a delete')` (Review
      Focus 4): with `http: { failKey: 'proxy' }` and the record on Work, `deleteProfile('Work')`
      rejects with a `ConfigurationError` whose `operation` is `'disable'`, and
      `profilesSetting.value` still holds Work.
  - `edit-profile.test.ts`:
    - `'says so, and saves nothing, when the profile is gone…'` expects the general `gone`
      warning.
    - New `it('treats a profile renamed in another window as gone')` (Review Focus 2).
    - New `it('reopens the name field with the reason when another window takes the name')`. The
      second name box opens with the attempted name and the validation message
      `"Lab" is already used in proxyToggler.profiles.`.
    - New `it('shows only the error when a renamed edit saves but cannot be applied')` (Review
      Focus 3): exactly one message, of kind `error`.
    - In the Delete describe, new `it('says the profile was already deleted when another window removed it')`.
  - `add-profile.test.ts`:
    - New `it('reopens the name step with the reason when another window takes the name')`. The
      URL is kept, and the reopened box is step 2 with the message.
    - New `it('opens an empty URL step without a message')`.
- [ ] **Step 2: Run them to see them fail.** Run: `npx mocha tests/unit/proxy-manager.test.ts tests/unit/edit-profile.test.ts tests/unit/add-profile.test.ts`
      Expected: FAIL on the new assertions.
- [ ] **Step 3: Return outcomes from the three `ProxyManager` methods.**
  - **Order of checks:** first `gone`, when no entry holds the name. Then `nameTaken`, when
    another entry holds the trimmed name ignoring case, with `validateProfileName`'s text as the
    reason. Then the existing validation, which still throws.
  - **Writes:** `gone` writes nothing and turns nothing off.
- [ ] **Step 4: Move the three commands and the switcher to `change`.**
  - **Add and Edit** loop back to the name step on `nameTaken`, with `getEntryNames()` read again.
  - **Edit** stops on `gone`, and continues with the saved name on `saved` or `writeFailed`. Its
    `ValidationError` catch, its `refreshUi` calls and its rename warning go.
  - **Delete** calls `change` after its confirmation.
  - **Switcher:** the side-switch items drop `await refreshUi()`.
  - **Remove:** `refreshUi` leaves every command signature, and `proxy-feedback.ts` is deleted.
- [ ] **Step 5: Validate a non-empty opening value in `askText`** by setting
      `input.validationMessage` from `step.validate(input.value)` before `show()`, only when the value
      is non-empty.
- [ ] **Step 6: Run the checks.** Run: `npm run check`
      Expected: exit 0, with `remote-windows.test.ts` passing unchanged.
- [ ] **Step 7: Commit** `refactor: report adding, editing and deleting profiles through one module`.
      The body names behaviour changes 2, 4 and 5 from the spec.

### Task 6: Documentation and full verification

**Files:**

- Modify: `ARCHITECTURE.md` ("Layers", the diagram, "How a command runs", "Ports", "Error model")
- Modify: `CHANGELOG.md` (`[Unreleased]` → `Changed` and `Fixed`)
- Modify: `README.md`, only where it describes a changed behaviour (check with
  `grep -n -i -E "toast|notification|Turn Proxy Off" README.md`)

**Interfaces:**

- Consumes: everything above.

- [ ] **Step 1: Update ARCHITECTURE.md.**
  - Commands call `change`, which runs the `ProxyManager` change, refreshes and reports.
  - The Ports table gains `Commands | ProxyChange | createProxyChange(…)`.
  - The Error model says expected races with other windows are outcomes, while a failed setting
    write is an exception that `change` catches once.
- [ ] **Step 2: Update the CHANGELOG.**
  - **Changed:** spec behaviour changes 1, 3 and 4.
  - **Fixed:** behaviour change 2, phrased as the misreports it ends: "deleted" for a profile
    already gone, "turned on" for a profile removed before Turn On.
- [ ] **Step 3: Run every check.** Run: `npm run check && npm run test:integration`
      Expected: both exit 0. If the integration run cannot download VS Code, report that with the
      output, not a pass.
- [ ] **Step 4: Commit** `docs: describe how a proxy change reports what it did`
