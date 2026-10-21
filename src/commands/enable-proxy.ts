import type { ProxyManager } from '../core/proxy-manager';
import type { VscodeApi } from '../vscode/api';
import type { Notifier } from '../vscode/notification-service';
import { announceSwitch, offerToConfigure, showKnownProxyError } from './proxy-feedback';

export async function enableProxyCommand(
  vscodeApi: Pick<VscodeApi, 'commands' | 'workspace'>,
  proxyManager: Pick<ProxyManager, 'enableProxy' | 'getState' | 'hasConfiguration'>,
  notificationService: Notifier,
  refreshUi: () => Promise<void>
): Promise<void> {
  if (!proxyManager.hasConfiguration()) {
    await offerToConfigure(vscodeApi, notificationService);
    return;
  }

  try {
    await proxyManager.enableProxy();
    await refreshUi();
    const name = proxyManager.getState().currentProfile?.name ?? '';
    await announceSwitch(vscodeApi, notificationService, `Proxy Toggler turned on ${name}.`);
  } catch (error: unknown) {
    await showKnownProxyError(vscodeApi, notificationService, error, { offerDisable: true });
  }
}
