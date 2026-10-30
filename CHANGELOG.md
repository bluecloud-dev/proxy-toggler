# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `proxyToggler.applyToTerminals` (off by default) gives new integrated terminals and tasks the
  proxy VS Code uses, as `http_proxy`, `https_proxy` and `no_proxy` and the same names in upper
  case, so Git, npm and other command-line tools use it too. It follows the proxy as it turns on,
  off or switches profiles. It leaves out credentials and never turns off certificate checks.
- Project defaults: `proxyToggler.defaultProfile` names the profile a project uses, or `false` for
  no proxy, and VS Code's proxy follows the focused window's choice. Your user settings give the
  default for every project that names none, and a switch or toggle made in a window stays that
  window's choice until it closes or reloads, or its profile is deleted or renamed. The switcher's
  **This Project** entries set it, and the toggle's tooltip says where the proxy came from. A
  project that names a profile you lack leaves the proxy alone and offers once to add it. Projects
  hold names only, never URLs (ADR 0006).

### Changed

- Restricted Mode: the extension's untrusted-workspace support is now `limited`, because a
  folder's settings cannot set `proxyToggler.defaultProfile` until you trust it.

## [0.2.0] - 2026-10-29

Proxy Toggler is now on the VS Code Marketplace as `bluecloud-dev.proxy-toggler`. Version 0.1.0 was
installed from a VSIX as `aymenhammouda.proxy-toggler`: uninstall it first, since both would manage
the proxy settings. VS Code keeps what an extension stores under its ID, so this version neither
reads the proxy 0.1.0 saved nor deletes the user name and password it stored. Add your proxy with
**Add Profile…**; while 0.1.0 left the proxy on, setup starts from VS Code's proxy settings.

### Added

- Remote windows: in SSH, Tunnels and remote container windows, the toggle and switcher manage the
  remote machine's own proxy settings and leave local windows alone. That machine keeps its own
  record, shared by every window connected to it, and the status bar names the host, or the
  remote type for containers. Turning the proxy off there writes an empty `http.proxy`, which keeps
  VS Code from handing the remote side this computer's proxy at start-up. In WSL and local
  container windows, the toggle manages this computer's settings, and its tooltip says so. Test
  Connection says where it ran.
- In WSL and local container windows, the switcher offers **Use a Separate Proxy for This Remote**,
  which gives the remote side its own proxy settings without a reload, and **Use This Computer's
  Proxy Again**, which also removes the remote machine's `http.*` values. While the current profile
  uses a loopback proxy, which WSL's NAT mode cannot reach, the first comes first.
- **Add Profile…** in two native steps with a Back button: the proxy URL, then the name, which
  defaults to the proxy host. When no profile exists and VS Code already uses a proxy, setup
  starts from those settings and names anything a profile cannot hold. If another window takes
  the name before the profile saves, the name step opens again with the reason and the proxy URL
  kept. If another window removes the profile before you click **Turn On**, a warning says so.
- **Edit Profile…** lists a profile's name, proxy URL, strict SSL choice and bypass list; each
  pick changes and saves one field. Saving the current profile while the proxy is on re-applies
  it, and an edit that makes a profile match VS Code's proxy settings while no profile did turns
  it on, as adding one does. A rename warns that keybindings using the old name stop working. When a saved edit
  cannot be applied, only the error shows, without that warning. If another window takes the new
  name before the edit saves, the name field opens again with the reason; if another window has
  removed the profile when a change saves, a warning says so and the edit ends. **Configure Proxy
  Settings** edits the current profile once one exists.
- **Delete Profile…** asks for confirmation. Deleting the current profile turns the proxy off
  first, and the first remaining profile becomes current. If another window or Settings Sync has
  already deleted the profile, a warning says so.
- Proxy profiles, kept in the `proxyToggler.profiles` setting: each has a name, a proxy URL, a
  strict SSL choice and a bypass list. The toggle turns the current profile on and off. The
  setting is shared by every VS Code Profile and read only from user settings.
- The switcher, behind a gear next to the status bar toggle and the **Proxy Toggler: Switch
  Profile…** command, lists the profiles alphabetically with the current one checked, then the
  proxy actions. It opens on the current profile, and picking a profile turns it on; a profile
  that another window has removed meanwhile gets a warning instead. Keybindings can pass a
  profile name to `proxyToggler.switchProfile`, and a name that no profile has shows the same
  warning, then opens the switcher.
- The README explains how VS Code uses proxy settings: signing in to a proxy, Settings Sync,
  VS Code Profiles, bypass patterns that work for all of VS Code, what "off" means, and
  `http.proxySupport`.
- The README shows keybinding snippets that pass a profile name to `proxyToggler.switchProfile`;
  Proxy Toggler ships no default keybindings.
- While VS Code's proxy settings carry a proxy that matches no profile, the toggle keeps its text
  but shows a warning icon, with the warning background where the theme has one, and its tooltip
  and screen-reader label say so. The switcher then offers **Save Current Settings as Profile…**,
  plus **Re-apply** the current profile while on or **Turn Proxy Off** while off. With no profile
  yet, the toggle says that VS Code already uses a proxy, and a click starts setup from it.
- With two or more profiles, the status bar shows the profile in use; tooltips and screen-reader
  labels always name the current profile.
- `proxyToggler.showSwitchNotifications` turns on a short notification that names the profile
  when the proxy turns on or off or switches profiles.
- **Test Connection…**, from Edit Profile and after saving a profile, sends one request through
  the profile's proxy to a URL you pick, prefilled with the Marketplace: a CONNECT tunnel and
  `HEAD /` for an `https://` URL, a plain request for an `http://` one. It reports a pass, a
  warning (a sign-in request, or an `http://` status the proxy may have sent) or a failure with
  the reason, says which side of VS Code reaches the URL directly, and stores and logs nothing.
  An answer longer than an HTTP head can be fails at once, so a server that streams without end
  cannot fill the extension host's memory.
- Test Connection checks certificates on both TLS connections against Node's built-in
  authorities. An untrusted or self-signed issuer is a warning that names it and links to the new
  README section on trusting a company's certificate authority; a name mismatch, or a certificate
  outside its dates, fails.
- SOCKS profiles: a proxy URL may use `socks://` or `socks5://`. `socks4`, `socks4a` and `socks5h`
  are refused with the reason: the VS Code window rejects the last two, and with `socks4` the
  window and extensions resolve host names in different places.
- An `http.proxy` that holds `user:pass@` matches the profile with the same URL, and the
  credentials never show anywhere Proxy Toggler shows or remembers a URL. Before Proxy Toggler
  first overwrites or clears such a value, a one-time notice says the credentials will be removed
  and what that means for sign-in.
- Profiles edited by hand or synced from another machine are checked like the UI's input. Invalid
  entries, and later entries that repeat a name, stay hidden, and one warning names them, once per
  distinct set. Its **Open Settings** button opens the application settings file.
- A **Proxy Toggler** output channel that logs unexpected errors. Credentials are never logged.
- Proxy Toggler works in Restricted Mode, when a folder is not trusted, and in virtual
  workspaces; VS Code used to disable it there. It reads no workspace files, and a workspace can
  only turn the toggle confirmation on or off.

### Changed

- A new icon and README banner.
- Proxy Toggler starts once VS Code has finished starting, instead of at its first command, so every
  window shows the toggle and keeps in step with the others from the start.
- The words are now on and off: the commands are **Turn Proxy On** and **Turn Proxy Off**, with
  the same command IDs. Turning the proxy on or off no longer shows a notification by default.
- When turning the proxy off fails, the error offers only **Open Settings**. 0.1.0's toggle
  offered **Disable Proxy** after any failed setting write, even when turning off was what failed
  and the button could not help. A failed turn-on still offers **Turn Proxy Off**.
- The notification that `proxyToggler.showSwitchNotifications` turns on no longer holds the
  command open. 0.1.0 kept the command running until you closed its notification, which delayed
  anything waiting for the command to finish.
- `proxyToggler.confirmBeforeToggle` asks only before the status bar toggle and the Toggle Proxy
  command.
- Require VS Code 1.97 or later; older releases keep Proxy Toggler 0.1.x. Releases before 1.91
  have no `http.noProxy` setting, so enabling the proxy failed after `http.proxy` had already been
  written. On 1.91 the VS Code window ignores an `http.proxy` that holds `user:pass@`, extensions
  get VS Code's proxy sign-in dialog only from 1.92, and remote windows need the
  `http.useLocalProxyConfiguration` setting, which arrived in 1.97.
- The extension package contains only the bundled `dist/extension.js` (12 files instead of 45).
- The source repository moved to
  [github.com/bluecloud-dev/proxy-toggler](https://github.com/bluecloud-dev/proxy-toggler); old
  links redirect.
- GitHub releases include a `SHA256SUMS` file for the VSIX.

### Removed

- The "VS Code proxy settings differ from Proxy Toggler state" notification: windows now keep in
  step without asking, and the toggle alone shows drift.

- The configure wizard's credentials, strict SSL and bypass-list steps: **Configure Proxy
  Settings** now adds the first profile in two steps.
- Stored proxy credentials. 0.1.x saved a username and password in the system keychain but never
  applied them; profiles hold none. When a proxy asks for a sign-in, VS Code shows its own login
  dialog.

### Fixed

- Every window and every VS Code Profile now shows the same on or off: each window compares its
  record with VS Code's proxy settings at activation and after every change, so a switch in one
  window shows in all of them, and a second VS Code Profile no longer shows "Not Configured" while
  the proxy is on. Only the focused window re-applies an outside edit to the current profile.

- Configure now shows the keychain message when the system keychain is locked or unavailable,
  instead of VS Code's generic "command failed" error.
- **Sync** on the "VS Code proxy settings differ from Proxy Toggler state" warning records the
  state the settings have when you click it. It used to record the state from when the warning
  appeared, so enabling or disabling the proxy while the warning was open left the status bar
  wrong.
- Proxy changes no longer overlap. A command that starts while another is still writing settings
  now waits and starts from its result, so clicking the status bar item twice quickly enables and
  then disables the proxy instead of enabling it twice.
- The status bar and the toggle no longer act on a stale state after quick, successive changes. VS
  Code can briefly report the previous stored state right after the extension has saved a new one,
  which could show the wrong status or make a toggle go the wrong way. The extension now trusts its
  own writes for five seconds.
- A failed enable no longer leaves the proxy half applied. When VS Code refuses one of the
  `http.*` settings, for example because a policy manages it, Proxy Toggler restores the settings
  it had already changed. If it cannot restore one, the error message names it.
- Configure now accepts a proxy URL with its scheme's default port, such as
  `http://proxy.example.com:80` or `https://proxy.example.com:443`. It used to reject the URL with
  "Port number is required", so an HTTP proxy on port 80 or an HTTPS proxy on port 443 could not
  be configured.

## [0.1.0] - 2025-12-19

### Added

- Secure proxy configuration storage (SecretStorage for credentials, globalState for non-sensitive config).
- Commands to configure, enable, disable, and toggle the proxy.
- Status bar indicator for proxy state (Not Configured / OFF / ON).
- Integration, unit, and security test coverage with 80%+ coverage gate.
