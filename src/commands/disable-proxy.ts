import type { ProxyManager as ProxyManagerService } from '../services/proxy-manager';
import { KeychainError } from '../services/keychain-service';
import { ConfigurationError } from '../services/proxy-manager';
import type { NotificationService as NotificationServiceService } from '../ui/notification-service';

type VscodeApi = {
  commands: {
    executeCommand: (command: string, ...args: unknown[]) => PromiseLike<unknown>;
  };
};

type ProxyManager = Pick<ProxyManagerService, 'disableProxy'>;

type NotificationService = Pick<NotificationServiceService, 'showSuccess' | 'showError'>;

type RefreshUi = () => Promise<void>;

const ACTION_OPEN_SETTINGS = { id: 'openSettings', title: 'Open Settings' } as const;

/**
 * Disables the proxy by clearing VS Code `http.*` settings.
 *
 * @param vscodeApi VS Code API surface used for commands execution.
 * @param proxyManager ProxyManager facade.
 * @param notificationService Notification helper (localized UI).
 * @param refreshUi Callback to refresh status bar and context keys.
 * @returns void
 * @throws {Error} If VS Code command execution fails unexpectedly.
 * @example
 * ```ts
 * await disableProxyCommand(vscode, proxyManager, notifications, refreshUi);
 * ```
 */
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
