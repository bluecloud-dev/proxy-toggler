# The focused window acts on outside changes

When VS Code's proxy settings or the profile list change, every open window hears about it, and
the change event does not say who made the change. A window that makes a change itself writes the
settings and treats its own change event as done. For any other change, such as a hand edit,
Settings Sync or another tool, only the focused window re-applies the current profile and shows
warnings and one-time notices; if no window has focus, the next window to gain it does. The
other windows update their own VS Code Profile's record without a message (settings cleared: off;
settings matching a profile: that profile is current and on) and refresh their status bar; they
never write the settings or show a warning or notice.

## Considered Options

- **Every window acts**, writing only the keys that differ and restoring only its own values.
  Rejected because the writes still race, an extension's settings write can fail when another
  window changed the file first, and every window shows its own warning.
- **No window re-applies outside edits**: they show as drift until the user re-applies the
  profile. Rejected because a valid edit to the current profile should apply as a UI edit does.

## Consequences

- Notification buttons check the state again when clicked and do nothing, and say so, if it has changed.
- VS Code fires the change event before `update()` resolves, so a window records its pending write
  before awaiting `update()`; otherwise it would take its own change for an outside one.
- An outside edit to the remembered current profile is applied whether a window saw it happen or
  first finds it at activation. A profile that is current only through the alphabetical fallback is
  never re-applied, so a synced deletion never reroutes the network.
- The window whose settings write failed shows only that error; the values the failure left behind
  show as drift on the toggle.
- Dismissed warnings are remembered per VS Code Profile, so a window in another VS Code Profile may
  show one once more.
- Each window writes only the record of the settings it manages
  ([ADR 0005](0005-each-record-lives-with-its-settings.md)). For a remote machine's own settings,
  the focused window among those connected to that machine acts on outside changes.
