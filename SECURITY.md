# Security policy

## Supported versions

Security fixes go to the default branch and to the latest published release.

| Version                  | Supported |
| ------------------------ | --------- |
| `main`                   | Yes       |
| Latest published release | Yes       |
| Older releases           | No        |

## Reporting a vulnerability

Do not report vulnerabilities in public issues, pull requests, or discussions. Report them
privately through GitHub:

https://github.com/bluecloud-dev/proxy-toggler/security/advisories/new

Include as much of this as you can:

- The Proxy Toggler version, commit, or VSIX, and your VS Code version and operating system.
- The affected area, such as credential storage, the `http.*` settings the extension writes,
  input validation, or the build and release pipeline.
- Steps to reproduce, with the configuration they need. Never include real proxy credentials.
- The impact: what an attacker could read, change, or send through a proxy.

Maintainers triage reports privately, fix confirmed problems, and publish an advisory once a fixed
release is available. There is no paid bug bounty. Reporters can ask to be credited in the
advisory and the release notes.

## Security controls

| Control                                                                                                      | Evidence                                                                               |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Credentials live only in VS Code SecretStorage and never reach `globalState`, messages, or logs.             | `tests/security/credentials.test.ts`                                                   |
| The extension never sets `http.proxyAuthorization`.                                                          | `tests/integration/config-update.test.ts`                                              |
| Proxy URLs, bypass lists, and credentials are validated before anything is stored.                           | `tests/unit/validation.test.ts`                                                        |
| A failed enable restores the user settings it already changed.                                               | `tests/unit/proxy-manager.test.ts`, integration tests                                  |
| The extension reads no workspace files, so it runs in Restricted Mode.                                       | `npm run test:packaged`                                                                |
| No telemetry SDK is in the dependency tree.                                                                  | `npm run check:no-telemetry`                                                           |
| The VSIX holds only the bundled extension, its manifest, and its documentation.                              | `scripts/check-package.cjs`                                                            |
| Dependencies and workflows are scanned: npm audit, CodeQL, dependency review, OpenSSF Scorecard, Dependabot. | `.github/workflows/ci.yml`, `.github/workflows/security.yml`, `.github/dependabot.yml` |
