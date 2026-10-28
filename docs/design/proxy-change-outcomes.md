# Proxy change outcomes: design

The architecture review of 2026-10-27 found that every command that changes the proxy rebuilds the
same steps by hand: make the change, refresh the status bar, say what happened, and explain a
failed setting write. Eight call sites did this, with copied wording, two lists of explainable
errors and no report of what the change actually did. So a deleted or vanished profile could be
announced as deleted or turned on when nothing happened. This note records the design the
maintainer agreed on, question by question (Q1–Q17), and the
[architecture research](architecture-research.md) that backs it. Terms come from the
[glossary](../../GLOSSARY.md). The [ADRs](../adr/) stand, with one line of ADR 0004 clarified.

## Decisions

| #   | Decision                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | All eight call sites go through one module: enable, disable, toggle, the switcher's profile pick and its on/off item, Add's **Turn On** button, saving an edit, and Delete. Add's save prompt and the switcher's side switch stay out. |
| Q2  | `ProxyManager`'s changes return an outcome for expected races. A failed setting write still throws `ConfigurationError` or `ProfileApplyError`, caught once in the module.                                                             |
| Q3  | The module refreshes the UI after every change, whether it succeeded or failed, and only then shows anything. Commands no longer receive `refreshUi`.                                                                                  |
| Q4  | The module words every message from the outcome. Success toasts stay behind `proxyToggler.showSwitchNotifications`.                                                                                                                    |
| Q5  | An error that can explain itself carries its own user message. No list of error classes remains; the registrar shows such a message or the command's fallback.                                                                         |
| Q6  | **Turn Proxy Off** is offered when the failed write's `operation` is `'enable'`, and never after a failed turn-off.                                                                                                                    |
| Q7  | The work lands on `refactor/proxy-change-outcomes`, stacked on `feat/v0.2.0-profiles`, and merges into it before v0.2.0 ships.                                                                                                         |
| Q8  | When a change finds its profile gone, the module always shows a non-blocking warning. ADR 0004 now reads "do nothing, and say so, if it has changed".                                                                                  |
| Q9  | When the name is taken at save time, Add and Edit go back to the name step and show the reason; the module stays silent.                                                                                                               |
| Q10 | Not configured is an outcome, answered with the **Configure Now** warning. Enable's up-front check goes; the toggle's routing to Add stays.                                                                                            |
| Q11 | The interface was designed three ways in parallel and compared; Q12 is the result.                                                                                                                                                     |
| Q12 | One function, `change((manager) => …)`, returning the outcome or `{ kind: 'writeFailed' }`. Commands hold only `ProxyManager` queries.                                                                                                 |
| Q13 | `enable-proxy.ts` and `disable-proxy.ts` are deleted; the composition root registers both commands directly.                                                                                                                           |
| Q14 | Success toasts go through `inform`, so they no longer hold a command open.                                                                                                                                                             |
| Q15 | Tests are replaced, not layered: one table-driven suite for the module, outcome assertions for `ProxyManager`, and the composition-root tests kept as smoke tests.                                                                     |
| Q16 | The switcher's side-switch items rely on the configuration listener to refresh the status bar; the remote-window tests confirm it.                                                                                                     |
| Q17 | **Proxy change** joins the glossary; ARCHITECTURE.md records the error rule; the CHANGELOG lists the behaviour changes.                                                                                                                |

## Outcomes

`src/core/proxy-outcome.ts` defines one discriminated union. Each `ProxyManager` method returns
only the members it can produce:

| Method                   | Returns                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `enableProxy()`          | `on` · `notConfigured`                                           |
| `disableProxy()`         | `off`                                                            |
| `toggleProxy()`          | `on` · `off` · `notConfigured`                                   |
| `switchTo(name)`         | `on` · `gone`                                                    |
| `addProfile(profile)`    | `saved` (with `isOn`) · `nameTaken`                              |
| `updateProfile(from, p)` | `saved` (with `renamedFrom` when renamed) · `gone` · `nameTaken` |
| `deleteProfile(name)`    | `deleted` · `gone`                                               |

- `on` carries the profile and `deleted` its name; `off` carries the current profile, or none when
  Not configured.
- `gone` carries the name and the change that found it gone: `'switch'`, `'save'` or `'delete'`.
  A switch finds a profile gone when no profile the switcher shows has the name; a save or a
  delete, when no entry of `proxyToggler.profiles` holds it, as `withProfile` and `withoutProfile`
  decide today. A change that finds its profile gone writes nothing.
- `saved` has `renamedFrom` when the saved name differs from the original, as Edit decides today,
  and `isOn` when the saved profile is current and on.
- `nameTaken` means another entry already holds the name, ignoring case. Its `reason` is the text
  `validateProfileName` gives. A blank or over-long name, an invalid proxy URL or bypass pattern
  still throws `ValidationError`: the input boxes refuse those before any save.

## The proxy change module

`src/commands/proxy-change.ts` replaces `proxy-feedback.ts`.

```ts
export type ProxyChanger = Pick<
  ProxyManager,
  | 'enableProxy'
  | 'disableProxy'
  | 'toggleProxy'
  | 'switchTo'
  | 'addProfile'
  | 'updateProfile'
  | 'deleteProfile'
>;
export type Reported<O extends ProxyOutcome> = O | { kind: 'writeFailed' };
export type ProxyChange = <O extends ProxyOutcome>(
  change: (manager: ProxyChanger) => Promise<O>
) => Promise<Reported<O>>;
export function createProxyChange(
  vscodeApi: Pick<VscodeApi, 'commands' | 'workspace'>,
  proxyManager: ProxyChanger,
  notifier: Notifier,
  refreshUi: () => Promise<void>
): ProxyChange;
```

Each call runs the change, refreshes the UI even when the change throws, and shows at most one
message. The function a command passes makes one `ProxyManager` call and never waits for the user.

| Result                                    | Shown                                                                                                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `on`                                      | Success, only when `showSwitchNotifications` is on: `Proxy Toggler turned on <name>.`                                                                                       |
| `off`                                     | Same gating: `Proxy Toggler turned off <name>.`, or `Proxy Toggler turned the proxy off.` without a profile                                                                 |
| `deleted`                                 | Same gating: `Proxy Toggler deleted <name>.`                                                                                                                                |
| `saved` with `renamedFrom`                | Warning: `Renamed <from> to <to>. Keybindings that switch to "<from>" by name stop working.`                                                                                |
| `saved` without, `nameTaken`              | Nothing; the caller handles them                                                                                                                                            |
| `gone`, change `'delete'`                 | Warning: `<name> was already deleted, in another window or through Settings Sync.`                                                                                          |
| `gone`, otherwise                         | Warning: `No proxy profile is named "<name>". The list may have changed in another window or through Settings Sync.`                                                        |
| `notConfigured`                           | Warning with **Configure Now**: `No proxy configuration found. Please configure proxy settings first.`                                                                      |
| A `ConfigurationError` in the cause chain | Error: the thrown error's own message, with **Open Settings**, and **Turn Proxy Off** when the failed write's `operation` is `'enable'`. Resolves `{ kind: 'writeFailed' }` |
| Any other error                           | Nothing; rethrown to the command registrar after the refresh                                                                                                                |

Messages without buttons go through `inform` and never hold the call. Messages with buttons wait
for the answer and for the command a button runs. A window whose write failed shows only that
error (ADR 0004).

## Errors

- `failedSettingWrite(error)` in `src/core/proxy-settings-writer.ts` follows `cause` links to the
  first `ConfigurationError`.
- `userMessageOf(error)` in `src/vscode/error-reporting.ts` returns the message of any error with a
  `toUserMessage()` method. The registrar shows it, or the command's fallback, so
  `error-reporting.ts` imports nothing from `src/core`.
- ARCHITECTURE.md's error model records the rule: races are outcomes, failed setting writes are
  exceptions.

## Commands

- The composition root creates `change` once and registers enable and disable as
  `change((manager) => manager.enableProxy())` and its counterpart.
- Toggle keeps its `confirmBeforeToggle` prompt, then calls `change`. Its up-front
  `hasConfiguration` check goes.
- The switcher's profile pick, its on/off/re-apply/clear items and the keybinding path call
  `change`. A keybinding that names a missing profile gets the `gone` warning, then the switcher.
- Add saves through `change`. On `nameTaken` it reopens the name step with the URL kept; on
  `saved` it shows its own prompts, and **Turn On** calls `change`.
- Edit saves through `change`. On `nameTaken` it reopens the name field with the attempted name;
  on `gone` it stops.
- Delete calls `change` after its confirmation.
- `askText` shows the problem with a non-empty value it opens with, so a reopened name step shows
  why the name cannot be used.

## Behaviour changes

1. A failed turn-off no longer offers **Turn Proxy Off**.
2. A change that finds its profile gone says so, instead of reporting success or doing nothing
   silently. A keybinding naming no profile shows that warning instead of an error.
3. Success toasts no longer hold the command open.
4. A name taken in another window during Add or Edit reopens the name step instead of ending with
   an error.
5. After an edit was saved but could not be applied, only the error shows, without the rename
   warning.

## Out of scope

- The side switch, `reconcile` and `migrateSavedProxy` keep their current shape; they belong to
  candidates 1 and 3 of the review.
- Profile validation stays where it is; consolidating it is candidate 4.
