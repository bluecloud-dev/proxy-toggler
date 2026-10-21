import type { ProxyManager } from '../core/proxy-manager';
import type { VscodeApi } from '../vscode/api';
import type { Notifier } from '../vscode/notification-service';
import { announceSwitch, showKnownProxyError } from './proxy-feedback';

export async function disableProxyCommand(
  vscodeApi: Pick<VscodeApi, 'commands' | 'workspace'>,
  proxyManager: Pick<ProxyManager, 'disableProxy' | 'getState'>,
  notificationService: Notifier,
  refreshUi: () => Promise<void>
): Promise<void> {
  try {
    await proxyManager.disableProxy();
    await refreshUi();
    // Turning the proxy off also works with no profile, when there is none to name.
    const name = proxyManager.getState().currentProfile?.name;
    await announceSwitch(
      vscodeApi,
      notificationService,
      name === undefined
        ? 'Proxy Toggler turned the proxy off.'
        : `Proxy Toggler turned off ${name}.`
    );
  } catch (error: unknown) {
    await showKnownProxyError(vscodeApi, notificationService, error, { offerDisable: false });
  }
}
