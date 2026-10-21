import * as os from 'node:os';

import type { VscodeApi } from './api';

// Which proxy settings a window's toggle and switcher manage (ADR 0005). A local window, and a
// remote window whose remote side uses this computer's proxy settings (WSL and local containers
// by default), manage this computer's. A remote window whose remote side keeps its own (SSH,
// Tunnels and remote containers by default) manages the remote machine's.
export type ProxySide = { kind: 'local'; remote?: string } | { kind: 'remote'; remote: string };

type SideApi = Pick<VscodeApi, 'env' | 'workspace'>;

export function proxySide(vscodeApi: SideApi): ProxySide {
  const remoteName = vscodeApi.env.remoteName;
  if (remoteName === undefined) {
    return { kind: 'local' };
  }
  // A machine setting, so in a remote window it reads the remote machine's value or its default,
  // which the remote server sets by remote type.
  const usesLocal = vscodeApi.workspace
    .getConfiguration('http')
    .get<boolean>('useLocalProxyConfiguration');
  const remote = remoteLabel(remoteName);
  return usesLocal === false ? { kind: 'remote', remote } : { kind: 'local', remote };
}

// The host name for SSH and Tunnels, where it names the machine; the remote type otherwise, as
// in containers, whose host names are generated.
function remoteLabel(remoteName: string): string {
  switch (remoteName) {
    case 'ssh-remote':
    case 'tunnel':
      return os.hostname();
    case 'wsl':
      return 'WSL';
    case 'dev-container':
      return 'Dev Container';
    case 'attached-container':
      return 'Container';
    case 'codespaces':
      return 'Codespaces';
    default:
      return remoteName;
  }
}
