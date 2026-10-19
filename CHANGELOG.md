# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- A **Proxy Toggler** output channel that logs unexpected errors. Credentials are never logged.

### Changed

- Require VS Code 1.91 or later. Earlier releases have no `http.noProxy` setting, so enabling the
  proxy failed after `http.proxy` had already been written.
- The extension package contains only the bundled `dist/extension.js` (12 files instead of 45).

### Fixed

- Configure now shows the keychain message when the system keychain is locked or unavailable,
  instead of VS Code's generic "command failed" error.
- **Sync** on the "VS Code proxy settings differ from Proxy Toggler state" warning records the
  state the settings have when you click it. It used to record the state from when the warning
  appeared, so enabling or disabling the proxy while the warning was open left the status bar
  wrong.

## [0.1.0] - 2025-12-19

### Added

- Secure proxy configuration storage (SecretStorage for credentials, globalState for non-sensitive config).
- Commands to configure, enable, disable, and toggle the proxy.
- Status bar indicator for proxy state (Not Configured / OFF / ON).
- Integration, unit, and security test coverage with 80%+ coverage gate.
