import type { ProxyManager } from '../core/proxy-manager';
import type { VscodeApi } from '../vscode/api';
import type { Notifier } from '../vscode/notification-service';
import { announceEnabled, offerToConfigure, showKnownProxyError } from './proxy-feedback';

export async function enableProxyCommand(
  vscodeApi: Pick<VscodeApi, 'commands'>,
  proxyManager: Pick<ProxyManager, 'hasConfiguration' | 'enableProxy'>,
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
    await announceEnabled(vscodeApi, notificationService);
  } catch (error: unknown) {
    await showKnownProxyError(vscodeApi, notificationService, error, { offerDisable: true });
  }
}
