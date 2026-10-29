# A project names its default profile, and VS Code's proxy follows the focused window

A user who keeps work and personal projects wants the work proxy only for the work project. VS
Code's `http.*` settings are application-scoped, or machine-scoped in some remote windows, so every
open window shares one value ([ADR 0002](0002-profiles-in-an-application-scoped-setting.md)); no
setting can give two open windows different proxies for VS Code's own traffic.

So each window has a choice for VS Code's proxy, and VS Code's proxy follows the focused window's
choice. A window's choice is its override, the last change the user made in that window with the
toggle, the switcher, Turn Proxy On or Off, or a keybinding; or else its default,
`proxyToggler.defaultProfile`. That setting holds a profile name, or `false` for no proxy, and is
window-scoped: the user's value is the default for every project that sets none, and a project's
`.vscode/settings.json`, or its `.code-workspace` file, overrides it. A window with neither
leaves the proxy alone, as before this decision. Integrated terminals, which each window has of its
own, get that window's choice whether or not it has focus, while `proxyToggler.applyToTerminals`
is on.

## Considered Options

- **Terminals only**: projects choose their terminals' proxy, and VS Code's own stays manual.
  Rejected because the user's own traffic, extensions and Copilot included, would still use the
  work proxy in personal projects.
- **Apply a project's default only when its window opens**: with two windows open, the last one
  opened would win, whichever the user works in.
- **Overrides that last until the window loses focus**: each switch between windows would undo
  the change the user just made.
- **Projects that hold a proxy URL and bypass list** (the v0.3.0 roadmap's workspace overrides):
  a repository would decide where the user's traffic goes, which breaks ADR 0002's rule that a
  repository cannot plant a profile. A project names a profile and never defines one.
- **Per-folder defaults in multi-root workspaces**: each folder would need its own terminal
  environment, and a rule for which folder's choice VS Code's proxy takes.

## Consequences

- A window applies its choice at activation if it has focus, when it gains focus, and when
  `proxyToggler.defaultProfile` changes while it has focus. Any change to that setting replaces the
  window's override. An outside change to `http.*`, such as a hand edit or Settings Sync, follows
  [ADR 0004](0004-focused-window-acts-on-outside-changes.md) and is not an override; the next
  focus change applies the window's choice again.
- Background traffic in a window without focus uses the focused window's proxy.
- An override lasts until its window closes or reloads; nothing stores it. An override that names
  a profile deleted or renamed since is dropped, and the window's default applies.
- A project that names a profile the user lacks, such as a teammate's or a renamed one, leaves the
  proxy alone and asks once per project to add it. Renaming a profile never rewrites a project's
  settings, which may be committed.
- Automatic switches show no notification, even with `proxyToggler.showSwitchNotifications` on.
  The toggle's tooltip and accessible label say whether the proxy is the project's default, the
  user's, or changed in this window.
- In Restricted Mode, VS Code returns only the user's value of `proxyToggler.defaultProfile`, which
  the manifest lists under `restrictedConfigurations`; the extension's untrusted-workspace support
  becomes `limited`.
- A remote window applies its choice to the settings it manages
  ([ADR 0005](0005-each-record-lives-with-its-settings.md)): an SSH, Tunnels or remote container
  window changes the remote machine's own proxy, a WSL or local container window this computer's.
- Windows in different VS Code Profiles follow the same rule, since `http.*` is shared across
  them. A profile that exists but is hidden as invalid counts as missing.
- `proxyToggler.applyToTerminals` is read only from user settings, so a repository cannot turn on
  its terminals' proxy.
