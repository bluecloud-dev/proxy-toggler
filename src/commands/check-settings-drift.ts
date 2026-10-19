import type { ProxyManager } from '../core/proxy-manager';
import type { NotificationAction, NotificationService } from '../vscode/notification-service';

const ACTION_SYNC: NotificationAction = { id: 'sync', title: 'Sync' };
const ACTION_DISMISS: NotificationAction = { id: 'dismiss', title: 'Dismiss' };

export async function checkSettingsDrift(
  proxyManager: Pick<
    ProxyManager,
    'getState' | 'hasConfiguration' | 'isConfigurationApplied' | 'syncToggleState'
  >,
  notificationService: Pick<NotificationService, 'showWarning'>,
  refreshUi: () => Promise<void>
): Promise<void> {
  if (!proxyManager.hasConfiguration()) {
    return;
  }

  if (proxyManager.getState().isEnabled === proxyManager.isConfigurationApplied()) {
    return;
  }

  const choice = await notificationService.showWarning(
    'VS Code proxy settings differ from Proxy Toggler state.',
    ACTION_SYNC,
    ACTION_DISMISS
  );
  if (choice !== ACTION_SYNC.id) {
    return;
  }

  await proxyManager.syncToggleState();
  await refreshUi();
}
