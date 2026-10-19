# Quality baseline

The standards this repository holds itself to. Each rule names what enforces it; "review" means a
reviewer checks it because no tool does yet.

## Architecture principles

- **Three layers and a composition root.** `src/core` holds domain logic, `src/commands` holds
  user workflows, `src/vscode` adapts the VS Code API, and `src/proxy-toggler.ts` wires them
  together. See [ARCHITECTURE.md](ARCHITECTURE.md). _Enforced by:_ ESLint `no-restricted-imports`.
- **One runtime door to VS Code.** Only `src/extension.ts` imports `vscode` at runtime; everything
  else receives the API slice it needs as a parameter and imports VS Code types only. _Enforced by:_
  ESLint.
- **Explicit wiring.** Dependencies are constructor or function parameters. No IoC container, no
  module-level singletons, no mutable module state. _Enforced by:_ review.
- **Depend on what you call.** Parameters are typed as the narrowest slice used, for example
  `Pick<ProxyManager, 'enableProxy' | 'hasConfiguration'>`, so tests need no casts. _Enforced
  by:_ type check and review.
- **Persisted data is a contract.** Storage keys and shapes listed in ARCHITECTURE.md change only
  with a migration and a CHANGELOG entry. _Enforced by:_ unit tests that pin them.

## Coding conventions

- **Naming.** Files are kebab-case. Types and classes are PascalCase; functions and variables are
  camelCase; module constants are SCREAMING_SNAKE_CASE. Names say what something is or does, so
  that comments are not needed to explain them.
- **Exports.** Export only what another module or a test uses. _Enforced by:_ knip
  (`npm run lint:unused`).
- **Types.** Use `type` aliases, not interfaces; string unions or `as const` objects, not enums;
  `satisfies` to check lookup tables. _Enforced by:_ ESLint
  (`consistent-type-definitions`) and review.
- **Errors.** Throw the domain error that explains the failure (`ValidationError`,
  `KeychainError`, `ConfigurationError`) and pass the original error as `{ cause }`. Commands
  handle only the errors they can explain to the user and rethrow everything else. Never swallow
  an error: an empty `catch` or `.catch(() => {})` is a defect. _Enforced by:_ review and the
  `no-floating-promises` lint rule.
- **Logging.** Use the `Logger` from the composition root (a `LogOutputChannel` named "Proxy
  Toggler"). The command registrar logs every unexpected command failure; background tasks start
  through `runInBackground`. Never log or display credentials. No `console` in `src`. _Enforced
  by:_ ESLint `no-console` and the security tests.
- **Async.** Await every promise or hand it to `runInBackground`. Commands are `async` functions
  that return `Promise<void>`. _Enforced by:_ typescript-eslint `no-floating-promises` and
  `no-misused-promises`.
- **Comments.** Comments explain why: a constraint, a trade-off, an edge case, or a link to a
  spec. Explanations longer than a sentence belong in ARCHITECTURE.md or this file. No
  commented-out code. _Enforced by:_ review.
- **Formatting and import order.** Prettier (exact version pinned) and
  `eslint-plugin-simple-import-sort`. _Enforced by:_ `npm run format:check` and `npm run lint` in
  CI.

## TypeScript standards

- `strict`, plus `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, and
  `noUncheckedIndexedAccess`. `exactOptionalPropertyTypes` stays off because the VS Code option
  types it would affect gain nothing from it.
- `module: Node16` (TypeScript 6 deprecates the old `node10` resolution) and `isolatedModules`
  (esbuild compiles files one at a time).
- Type-only imports use `import type`. Exported functions declare their return types. No `any`;
  use `unknown` and narrow. _Enforced by:_ typescript-eslint `recommendedTypeChecked`,
  `consistent-type-imports`, and `explicit-module-boundary-types`.
- `@types/vscode` is pinned to the `engines.vscode` minimum, so APIs newer than the supported
  range fail to compile. `@types/node` tracks the Node major of that VS Code release (Node 20 for
  VS Code 1.91).

## VS Code extension standards

- **Activation events.** Keep `"activationEvents": []` while the extension only contributes
  commands: since VS Code 1.74, contributed commands activate the extension. Add an event only for
  a trigger VS Code cannot infer, and prefer a narrow event over `onStartupFinished` or `*`.
- **Disposables.** Everything that holds a VS Code resource (status bar item, log channel, command
  registration) goes into `context.subscriptions`. Objects without resources do not implement
  `dispose`.
- **Command registration.** Register commands only through the registrar from
  `vscode/error-reporting.ts`, with an existing user-facing failure message. Command ids live in
  `src/commands/command-ids.ts`, and every id must match a `contributes.commands` entry.
- **Configuration.** Read extension settings through the injected `workspace.getConfiguration`
  with an explicit default. Write `http.*` settings only through `vscode/http-settings.ts`, which
  always targets user (global) settings and writes `http.noProxy` as an array.
- **Secrets.** Credentials live only in `context.secrets`; `globalState` and settings are
  plaintext. Display stored credentials only as a mask.
- **Localization.** Pass string literals to `l10n.t`, with `{0}` placeholders for values, so
  that strings can be extracted. Manifest strings live in `package.nls.json`.
- **Compatibility.** `engines.vscode` names the oldest release the integration tests pass on.
  Raising it is a behavior change that needs a CHANGELOG entry.
- **No telemetry.** _Enforced by:_ `npm run check:no-telemetry` in CI.

## Webview standards

The extension has no webviews or custom editors today. If one is added:

- Set a Content Security Policy that starts from `default-src 'none'` and allows only
  `webview.cspSource`, plus a nonce for scripts. No inline scripts or styles.
- Restrict `localResourceRoots` to the folders the view needs, such as `media/`, and load
  resources through `webview.asWebviewUri`.
- Define the extension-webview message contract as a discriminated union shared by both sides,
  and validate every incoming message at runtime before acting on it.
- Never insert unsanitized text into HTML. Escape user or workspace content, or build DOM nodes
  with `textContent`.
- Do not send secrets to a webview.

## Testing strategy

- Unit and security tests cover `src/core`, `src/commands`, and the `src/vscode` adapters against
  the fakes in `tests/support/`. Integration tests cover activation, command registration, the
  settings round trip, and the status bar in a real VS Code, on the minimum engine and on stable.
  Details are in [TESTING.md](TESTING.md).
- **Minimum coverage:** 80% for statements, branches, functions, and lines, enforced by
  `npm run coverage` in CI. Coverage must not drop in a change unless the drop is explained in
  that change.
- Every bug fix comes with a test that fails without it. Every new command gets an activation or
  registration check in the integration suite.

## Dependency standards

- **Runtime footprint:** no runtime dependencies. The VSIX ships one bundled file,
  `dist/extension.js`. Adding a runtime dependency needs a stated reason. _Enforced by:_
  `npm run package`, which runs `scripts/check-package.cjs`: the package must hold exactly the
  listed files, stay under 256 KiB, and carry the name, publisher, version, and `main` of
  `package.json`.
- **Pinning:** `package-lock.json` is committed and CI installs with `npm ci`. Prettier and
  `@types/vscode` are pinned exactly; other dev dependencies use caret ranges.
- **Install scripts:** npm 11.19 and later block dependency install scripts unless
  `allowScripts` allows them. All three are denied (`esbuild`, `keytar`, `@vscode/vsce-sign`),
  because building, testing, and packaging work without them. Approve one only for a tool that
  fails without it.
- **Overrides:** use `overrides` only to force a patched transitive release when the parent
  package cannot be upgraded, and record why. Current entry: `serialize-javascript` `^7.0.5`,
  because Mocha 11 pins `^6` and Mocha 12 cannot load in VS Code 1.91's extension host. Remove it
  when the runner moves to Mocha 12.
- **Updates:** review `npm outdated` and GitHub Actions versions at least monthly, and before each
  release. Upgrade one major version per change, with the full check suite and the integration
  tests on both VS Code versions. A Dependabot configuration for npm and GitHub Actions is the
  recommended next step (see the refactor report).
- **Security scanning:** CI fails on high or critical advisories (`npm audit --audit-level=high`).
  Fix moderate advisories when a non-major fix exists.
- **Toolchain:** Node comes from `.nvmrc` (24 LTS), locally and in CI.

## Documentation conventions

- `README.md` is for users, plus a Development section for contributors. `ARCHITECTURE.md`
  covers structure and decisions, `TESTING.md` covers tests and the manual QA checklist, this file
  covers standards, and `CHANGELOG.md` follows Keep a Changelog.
- Any change a user can notice gets a CHANGELOG entry under "Unreleased".
- Commit messages follow Conventional Commits (`feat`, `fix`, `refactor`, `build`, `ci`, `docs`,
  `test`, `chore`) and record the evidence for removals and behavior changes.
- Documentation is formatted by Prettier; new top-level files are added to the allowlist in
  `.prettierignore`.

## References

Official VS Code documentation. The Microsoft Learn MCP server returned no VS Code extension
pages, so these code.visualstudio.com pages were read through Context7
(`/websites/code_visualstudio_api`):

- Activation events: https://code.visualstudio.com/api/references/activation-events
- Commands: https://code.visualstudio.com/api/extension-guides/command
- Extension anatomy and `@types/vscode` versioning:
  https://code.visualstudio.com/api/get-started/extension-anatomy
- API reference (`createOutputChannel`, `LogOutputChannel`, `SecretStorage`):
  https://code.visualstudio.com/api/references/vscode-api
- Testing extensions: https://code.visualstudio.com/api/working-with-extensions/testing-extension
- Bundling extensions: https://code.visualstudio.com/api/working-with-extensions/bundling-extension
- Publishing and engine compatibility:
  https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- Webview security: https://code.visualstudio.com/api/extension-guides/webview
- Secrets versus `globalState` (remote extensions guide):
  https://code.visualstudio.com/api/advanced-topics/remote-extensions

Microsoft Learn:

- Secure the developer environment for Zero Trust (trusting extensions and their publishers):
  https://learn.microsoft.com/security/zero-trust/develop/secure-dev-environment-zero-trust

Ecosystem documentation through Context7:

- ESLint v10 (`/eslint/eslint/v10.5.0`): migration guide, `globalIgnores`, `no-restricted-imports`
  `allowTypeImports`.
- typescript-eslint (`/typescript-eslint/typescript-eslint`): flat config with `projectService`,
  disabling typed linting for JavaScript, deprecation of its `no-restricted-imports` extension.
- eslint-config-prettier (`/prettier/eslint-config-prettier`): the `/flat` entry point and the
  "last in the array" rule.
- Prettier (`/prettier/prettier`): exact-version pinning; `.gitignore` respected since 3.0.
- npm (`/npm/cli`): `prepublish` is deprecated and runs on `npm install` and `npm ci`.
- TypeScript (`/microsoft/typescript-website`): TypeScript 6.0 deprecates `node10` resolution;
  `node16` module semantics; subclassing built-ins needs `setPrototypeOf` only for ES5 output.
- Mocha (`/mochajs/mocha`): Mocha 12 requires Node `^20.19.0 || >=22.12.0`.
- Knip (`/websites/knip_dev`): entry files, issue types, v6 changes.

Primary sources read directly:

- `http.noProxy` introduction: microsoft/vscode#211956 and
  `src/vs/platform/request/common/request.ts` at tags 1.90.0 and 1.91.0.
- Node.js release schedule: https://nodejs.org/en/about/previous-releases
- `@vscode/test-electron` 3.1.0 package source (macOS executable resolution, default launch
  arguments).
- `npm help install-scripts` (npm 11.19).
