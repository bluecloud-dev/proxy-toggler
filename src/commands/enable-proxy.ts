import { KeychainError } from '../core/keychain-service';
import type { ProxyManager as ProxyManagerService } from '../core/proxy-manager';
import { ConfigurationError } from '../core/proxy-manager';
import type {
  NotificationAction,
  NotificationService as NotificationServiceService
} from '../vscode/notification-service';

type VscodeApi = {
  commands: {
    executeCommand: (command: string, ...args: unknown[]) => PromiseLike<unknown>;
  };
};

type ProxyManager = Pick<ProxyManagerService, 'hasConfiguration' | 'enableProxy'>;

type NotificationService = Pick<
  NotificationServiceService,
  'showSuccess' | 'showWarning' | 'showError'
>;

type RefreshUi = () => Promise<void>;

const ACTION_CONFIGURE_NOW: NotificationAction = { id: 'configure', title: 'Configure Now' };
const ACTION_DISABLE_PROXY: NotificationAction = { id: 'disableProxy', title: 'Disable Proxy' };
const ACTION_OPEN_SETTINGS: NotificationAction = { id: 'openSettings', title: 'Open Settings' };

export async function enableProxyCommand(
  vscodeApi: VscodeApi,
  proxyManager: ProxyManager,
  notificationService: NotificationService,
  refreshUi: RefreshUi
): Promise<void> {
  if (!proxyManager.hasConfiguration()) {
    const choice = await notificationService.showWarning(
      'No proxy configuration found. Please configure proxy settings first.',
      ACTION_CONFIGURE_NOW
    );

    if (choice === ACTION_CONFIGURE_NOW.id) {
      await vscodeApi.commands.executeCommand('proxyToggler.configure');
    }

    return;
  }

  try {
    await proxyManager.enableProxy();
    await refreshUi();
    const choice = await notificationService.showSuccess('Proxy enabled', ACTION_DISABLE_PROXY);
    if (choice === ACTION_DISABLE_PROXY.id) {
      await vscodeApi.commands.executeCommand('proxyToggler.disable');
    }
  } catch (error: unknown) {
    await showEnableError(vscodeApi, notificationService, error);
  }
}

async function showEnableError(
  vscodeApi: VscodeApi,
  notificationService: NotificationService,
  error: unknown
): Promise<void> {
  if (error instanceof KeychainError) {
    await notificationService.showError(error.toUserMessage());
    return;
  }

  if (error instanceof ConfigurationError) {
    const choice = await notificationService.showError(
      error.toUserMessage(),
      ACTION_OPEN_SETTINGS,
      ACTION_DISABLE_PROXY
    );

    if (choice === ACTION_OPEN_SETTINGS.id) {
      await vscodeApi.commands.executeCommand(
        'workbench.action.openSettings',
        error.getSettingId()
      );
    } else if (choice === ACTION_DISABLE_PROXY.id) {
      await vscodeApi.commands.executeCommand('proxyToggler.disable');
    }
    return;
  }

  await notificationService.showError('Failed to enable proxy.');
}
