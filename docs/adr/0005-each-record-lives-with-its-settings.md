# Each record lives with the proxy settings it describes

Proxy Toggler keeps a record, on or off plus the current profile, for each set of proxy settings it
manages. Local settings keep theirs in `globalState`, per VS Code Profile. A remote machine that
keeps its own proxy settings (SSH, Tunnels and remote containers by default, or any remote with
`http.useLocalProxyConfiguration: false`) keeps its record in a file in the extension's
`globalStorageUri`, which VS Code places on that machine
([extHostStoragePaths.ts](https://github.com/microsoft/vscode/blob/1.142.0/src/vs/workbench/api/common/extHostStoragePaths.ts#L89-L91)).
`globalState` is local and shared by the local and remote windows of a VS Code Profile
([extHostExtensionService.ts](https://github.com/microsoft/vscode/blob/1.142.0/src/vs/workbench/api/common/extHostExtensionService.ts#L504-L506)),
so a remote window that wrote it would overwrite the local record.

## Considered Options

- **Key `globalState` by remote machine.** Rejected because stable API exposes no machine identity:
  `vscode.env.remoteAuthority` is proposed API
  ([extHost.api.impl.ts](https://github.com/microsoft/vscode/blob/1.142.0/src/vs/workbench/api/common/extHost.api.impl.ts#L494-L497)),
  the remote extension host sees every URI rewritten to `file:`, and one SSH host can appear under
  several authorities.
- **No record for remote machines**, deriving on/off from their settings. Rejected because the toggle
  must remember which profile to turn on while the proxy is off.

## Consequences

- Proxy Toggler runs on the remote side, its default `workspace` kind, so it must be installed on
  the remote machine.
- Every window connected to a machine shares that machine's record, and local windows keep theirs.
- A remote machine's record is never synced, like the machine settings it describes.
- A window writes only the record of the settings it manages.
