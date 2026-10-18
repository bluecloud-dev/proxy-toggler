import type { ProxyManager } from '../core/proxy-manager';
import type { VscodeApi } from '../vscode/api';
import type { Notifier } from '../vscode/notification-service';
import { showProxyError } from './proxy-feedback';

export async function disableProxyCommand(
  vscodeApi: Pick<VscodeApi, 'commands'>,
  proxyManager: Pick<ProxyManager, 'disableProxy'>,
  notificationService: Notifier,
  refreshUi: () => Promise<void>
): Promise<void> {
  try {
    await proxyManager.disableProxy();
    await refreshUi();
    await notificationService.showSuccess('Proxy disabled');
  } catch (error: unknown) {
    await showProxyError(vscodeApi, notificationService, error, {
      fallbackMessage: 'Failed to disable proxy.',
      offerDisable: false
    });
  }
}
