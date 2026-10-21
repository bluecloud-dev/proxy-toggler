# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Add Profile…** in two native steps with a Back button: the proxy URL, then the name, which
  defaults to the proxy host. When no profile exists and VS Code already uses a proxy, setup
  starts from those settings and names anything a profile cannot hold.
- **Edit Profile…** lists a profile's name, proxy URL, strict SSL choice and bypass list; each
  pick changes and saves one field. Saving the current profile while the proxy is on re-applies
  it, and a rename warns that keybindings using the old name stop working. **Configure Proxy
  Settings** edits the current profile once one exists.
- **Delete Profile…** asks for confirmation. Deleting the current profile turns the proxy off
  first, and the first remaining profile becomes current.
- Proxy profiles, kept in the `proxyToggler.profiles` setting: each has a name, a proxy URL, a
  strict SSL choice and a bypass list. The toggle turns the current profile on and off. The
  setting is shared by every VS Code Profile and read only from user settings.
- Each VS Code Profile copies its 0.1.x configuration into a profile named after the proxy host,
  and makes it current without turning it on. The 0.1.x configuration stays as it was, so a
  downgrade still finds it.
- The switcher, behind a gear next to the status bar toggle and the **Proxy Toggler: Switch
  Profile…** command, lists the profiles alphabetically with the current one checked, then the
  proxy actions. It opens on the current profile, and picking a profile turns it on. Keybindings
  can pass a profile name to `proxyToggler.switchProfile`.
- The README shows keybinding snippets that pass a profile name to `proxyToggler.switchProfile`;
  Proxy Toggler ships no default keybindings.
- With two or more profiles, the status bar shows the profile in use; tooltips and screen-reader
  labels always name the current profile.
- `proxyToggler.showSwitchNotifications` turns on a short notification that names the profile
  when the proxy turns on or off or switches profiles.
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

- The words are now on and off: the commands are **Turn Proxy On** and **Turn Proxy Off**, with
  the same command IDs. Turning the proxy on or off no longer shows a notification by default.
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

- The configure wizard's credentials, strict SSL and bypass-list steps: **Configure Proxy
  Settings** now adds the first profile in two steps.
- Stored proxy credentials. 0.1.x saved a username and password in the system keychain but never
  applied them. Proxy Toggler now deletes them and says so once; when a proxy asks for a sign-in,
  VS Code shows its own login dialog.

### Fixed

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
