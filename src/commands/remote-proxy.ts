import { isIP } from 'node:net';

import type { Profile } from '../core/profiles';
import type { VscodeApi } from '../vscode/api';
import { proxySide } from '../vscode/proxy-side';

type RemoteProxyApi = Pick<VscodeApi, 'ConfigurationTarget' | 'env' | 'l10n' | 'workspace'>;

export type RemoteProxyChoice = {
  label: string;
  action: 'separate' | 'shared';
  detail?: string;
  // Listed before the profiles, because the current profile cannot work on the remote side.
  first: boolean;
};

// What the switcher offers for whose proxy settings the remote side of this window uses: a
// remote that uses this computer's can get its own, and a WSL or local container remote that
// has its own can go back (docs/design/v0.2.0-profiles-and-ux.md, "Remote windows").
export function remoteProxyChoice(
  vscodeApi: RemoteProxyApi,
  currentProfile: Profile | undefined
): RemoteProxyChoice | undefined {
  const { l10n } = vscodeApi;
  const side = proxySide(vscodeApi);
  if (side.kind === 'remote') {
    return side.sharedByDefault
      ? { label: l10n.t("Use This Computer's Proxy Again"), action: 'shared', first: false }
      : undefined;
  }
  if (side.remote === undefined) {
    return undefined;
  }
  const loopback = currentProfile && loopbackHost(currentProfile.proxyUrl);
  return {
    label: l10n.t('Use a Separate Proxy for This Remote'),
    action: 'separate',
    ...(loopback && {
      detail: l10n.t(
        "{0} uses {1}, a loopback address, which WSL's NAT mode cannot reach on this computer.",
        currentProfile.name,
        loopback
      )
    }),
    first: loopback !== undefined
  };
}

// The remote side switches without a reload (TESTING.md, "Remote windows", check 3).
export async function useSeparateProxy(vscodeApi: RemoteProxyApi): Promise<void> {
  await vscodeApi.workspace
    .getConfiguration('http')
    .update('useLocalProxyConfiguration', false, vscodeApi.ConfigurationTarget.Global);
}

// The remote machine's http.* values go first, while they still belong to it. Once the remote
// side uses this computer's settings, a write of a key that the remote file still holds lands
// there and changes nothing (TESTING.md, "Remote windows", check 2).
export async function useThisComputersProxy(vscodeApi: RemoteProxyApi): Promise<void> {
  const http = vscodeApi.workspace.getConfiguration('http');
  const target = vscodeApi.ConfigurationTarget.Global;
  for (const key of ['proxy', 'proxyStrictSSL', 'noProxy']) {
    await http.update(key, undefined, target);
  }
  await http.update('useLocalProxyConfiguration', undefined, target);
}

// The proxy's host when it is a loopback address, which means a different machine on the remote
// side.
function loopbackHost(proxyUrl: string): string | undefined {
  let host: string;
  try {
    host = new URL(proxyUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  const address = host.replace(/^\[(.*)\]$/, '$1');
  const loopback =
    address === 'localhost' ||
    address.endsWith('.localhost') ||
    (isIP(address) === 4 && address.startsWith('127.')) ||
    address === '::1';
  return loopback ? host : undefined;
}
