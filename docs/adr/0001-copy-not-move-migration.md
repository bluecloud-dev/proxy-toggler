# Migrate 0.1.x data by copying it, never moving it

v0.2.0 copies the single 0.1.x configuration (`proxyToggler.savedProxy` in `globalState`) into a
profile and never writes or deletes that key again. A downgrade to 0.1.x therefore still finds a
working configuration, and a failed migration leaves the 0.1.x data as the only configuration until
migration retries at the next activation. The two 0.1.x credential secrets are the one exception:
v0.2.0 deletes them, because they are secrets and no version ever applied them (see
[ADR 0003](0003-no-stored-proxy-credentials.md)).

## Considered Options

- **Move with undo**: copy, delete the old key, and undo on failure. Rejected because a downgrade
  would then find nothing.
- **Dual-write**: copy every later change of the current profile back into `savedProxy`. Rejected
  because it keeps the 0.1.x format alive for every future change, only so that a downgrade sees
  edits made after the upgrade.

## Consequences

- A downgrade sees the configuration as it was at migration, without later edits.
- A 0.1.x window still open after the update applies the values in `savedProxy`. v0.2.0 windows
  treat that like any other settings change: while the migrated profile still has those values, it
  becomes current and on without a message, and drift appears only when no profile matches, for
  example after the migrated profile was edited or deleted.
- `globalState` is per VS Code Profile, so each VS Code Profile migrates its own `savedProxy`,
  adding a profile only when none has the same proxy URL, strict SSL and bypass list.
- The old key never disappears, so a marker in each VS Code Profile's `globalState` records the
  values it migrated. If `savedProxy` later differs, because a downgrade or a 0.1.x window changed
  it, the next activation migrates the new values too. Within one VS Code Profile, an unchanged
  `savedProxy` never brings back a deleted profile; another VS Code Profile's first migration may
  add it once more.
- In a VS Code Profile that has no current profile yet, migration makes the migrated profile, or
  the existing profile with the same values, the current one without turning the proxy on, so the
  toggle keeps turning on the proxy that VS Code Profile used in 0.1.x.
- The marker is written only once a later read, after the settings settle, still shows the migrated
  profile. Until then each activation retries, so two VS Code Profiles migrating at startup cannot
  lose each other's profile.
