import { isLoopback } from '../core/bypass';
import type { Profile } from '../core/profiles';
import type { VscodeApi } from '../vscode/api';
import { proxySide } from '../vscode/proxy-side';

type RemoteProxyApi = Pick<VscodeApi, 'env' | 'l10n' | 'workspace'>;

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
        '{0} uses {1}, a loopback address, which WSL in NAT mode and containers cannot reach on this computer.',
        currentProfile.name,
        loopback
      )
    }),
    first: loopback !== undefined
  };
}

// The proxy's host when it is a loopback address, which on the remote side means the remote
// machine, not this computer.
function loopbackHost(proxyUrl: string): string | undefined {
  if (!URL.canParse(proxyUrl)) {
    return undefined;
  }
  const host = new URL(proxyUrl).hostname;
  return isLoopback(host) ? host : undefined;
}
