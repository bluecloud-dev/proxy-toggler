import { KeychainError } from '../core/keychain-service';
import type { ProxyManager as ProxyManagerService } from '../core/proxy-manager';
import { ConfigurationError } from '../core/proxy-manager';
import type { NotificationService as NotificationServiceService } from '../vscode/notification-service';

type VscodeApi = {
  commands: {
    executeCommand: (command: string, ...args: unknown[]) => PromiseLike<unknown>;
  };
};

type ProxyManager = Pick<ProxyManagerService, 'disableProxy'>;

type NotificationService = Pick<NotificationServiceService, 'showSuccess' | 'showError'>;

type RefreshUi = () => Promise<void>;

const ACTION_OPEN_SETTINGS = { id: 'openSettings', title: 'Open Settings' } as const;

export async function disableProxyCommand(
  vscodeApi: VscodeApi,
  proxyManager: ProxyManager,
  notificationService: NotificationService,
  refreshUi: RefreshUi
): Promise<void> {
  try {
    await proxyManager.disableProxy();
    await refreshUi();
    await notificationService.showSuccess('Proxy disabled');
  } catch (error: unknown) {
    await showDisableError(vscodeApi, notificationService, error);
  }
}

async function showDisableError(
  vscodeApi: VscodeApi,
  notificationService: NotificationService,
  error: unknown
): Promise<void> {
  if (error instanceof KeychainError) {
    await notificationService.showError(error.toUserMessage());
    return;
  }

  if (error instanceof ConfigurationError) {
    const choice = await notificationService.showError(error.toUserMessage(), ACTION_OPEN_SETTINGS);
    if (choice === ACTION_OPEN_SETTINGS.id) {
      await vscodeApi.commands.executeCommand(
        'workbench.action.openSettings',
        error.getSettingId()
      );
    }
    return;
  }

  await notificationService.showError('Failed to disable proxy.');
}
