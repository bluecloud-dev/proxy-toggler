import type { ProxyManager } from '../core/proxy-manager';
import type { VscodeApi } from '../vscode/api';
import type { NotificationAction, Notifier } from '../vscode/notification-service';
import { announceEnabled, offerToConfigure, showKnownProxyError } from './proxy-feedback';

const ACTION_CANCEL: NotificationAction = { id: 'cancel', title: 'Cancel' };

export async function toggleProxyCommand(
  vscodeApi: Pick<VscodeApi, 'commands' | 'workspace'>,
  proxyManager: Pick<ProxyManager, 'hasConfiguration' | 'getState' | 'toggleProxy'>,
  notificationService: Notifier,
  refreshUi: () => Promise<void>
): Promise<void> {
  if (!proxyManager.hasConfiguration()) {
    await offerToConfigure(vscodeApi, notificationService);
    return;
  }

  if (shouldConfirmToggle(vscodeApi)) {
    const confirmed = await confirmToggle(notificationService, proxyManager.getState().isEnabled);
    if (!confirmed) {
      return;
    }
  }

  try {
    const isEnabled = await proxyManager.toggleProxy();
    await refreshUi();
    if (isEnabled) {
      await announceEnabled(vscodeApi, notificationService);
    } else {
      await notificationService.showSuccess('Proxy disabled');
    }
  } catch (error: unknown) {
    await showKnownProxyError(vscodeApi, notificationService, error, { offerDisable: true });
  }
}

function shouldConfirmToggle(vscodeApi: Pick<VscodeApi, 'workspace'>): boolean {
  return vscodeApi.workspace
    .getConfiguration('proxyToggler')
    .get<boolean>('confirmBeforeToggle', false);
}

async function confirmToggle(notificationService: Notifier, isEnabled: boolean): Promise<boolean> {
  const confirmAction: NotificationAction = {
    id: 'confirm',
    title: isEnabled ? 'Disable' : 'Enable'
  };
  const message = isEnabled ? 'Disable proxy?' : 'Enable proxy?';

  const choice = await notificationService.showWarning(message, confirmAction, ACTION_CANCEL);
  return choice === confirmAction.id;
}
