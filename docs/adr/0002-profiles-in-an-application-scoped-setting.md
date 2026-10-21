# Store profiles in an application-scoped setting

Profiles live in the `proxyToggler.profiles` setting, declared with application scope, instead of
in `globalState`. The `http.*` settings that profiles drive are application-scoped, so every VS Code
Profile shares one value
([request.ts](https://github.com/microsoft/vscode/blob/1.91.0/src/vs/platform/request/common/request.ts#L201)),
while `globalState` is stored separately for each VS Code Profile
([extensionStorage.ts](https://github.com/microsoft/vscode/blob/1.91.0/src/vs/platform/extensionManagement/common/extensionStorage.ts#L161-L175)),
so each VS Code Profile would keep its own list over one shared proxy. An application-scoped
setting is shared the same way, VS Code never reads it from workspace files, so a repository cannot
plant a profile, and users can edit it in settings.json.

## Consequences

- A profile is identified by its name, which keybindings and later workspace features use to refer
  to it.
- Settings Sync copies the list to the user's other machines.
- The current profile and the on/off state of the local settings stay in `globalState`, so each VS
  Code Profile keeps its own; a remote machine's own settings keep theirs on that machine
  ([ADR 0005](0005-each-record-lives-with-its-settings.md)). Every window reconciles its record with
  the `http.*` settings it manages.
- Hand edits and Settings Sync changes pass the same checks as the UI. Invalid entries and repeated
  names stay out of the switcher, and one warning names them. The first entry with a name owns it,
  valid or not, so the UI never saves under a name that a hidden entry holds.
- An entry saved by a newer version can stay invalid here for good, so the warning appears once for
  each distinct set of flagged entries, and its dismissal lasts, per VS Code Profile, until that set
  changes.
- A rename seen only through settings.json looks like a delete plus an add, so the current profile
  is remembered by name and by values.
- A save from the UI replaces or removes only the entry it changes, keeping invalid entries,
  repeated names and unknown fields, so versions that share the list through Settings Sync never
  strip each other's data.
- Settings Sync uploads proxy hosts and bypass patterns; the README says so and shows how to
  exclude the setting.
