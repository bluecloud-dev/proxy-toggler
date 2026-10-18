# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Require VS Code 1.91 or later. Earlier releases have no `http.noProxy` setting, so enabling the
  proxy failed after `http.proxy` had already been written.

## [0.1.0] - 2025-12-19

### Added

- Secure proxy configuration storage (SecretStorage for credentials, globalState for non-sensitive config).
- Commands to configure, enable, disable, and toggle the proxy.
- Status bar indicator for proxy state (Not Configured / OFF / ON).
- Integration, unit, and security test coverage with 80%+ coverage gate.
