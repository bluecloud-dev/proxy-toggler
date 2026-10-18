import type { ProxyManager as ProxyManagerService } from '../services/proxy-manager';
import { KeychainError } from '../services/keychain-service';
import { ConfigurationError } from '../services/proxy-manager';
import type {
  NotificationAction,
  NotificationService as NotificationServiceService
} from '../ui/notification-service';

const CONFIRM_BEFORE_TOGGLE_SETTING = 'confirmBeforeToggle';
const SETTINGS_SECTION = 'proxyToggler';

type WorkspaceConfiguration = {
  get: <T>(section: string, defaultValue?: T) => T;
};

type VscodeApi = {
  commands: {
    executeCommand: (command: string, ...args: unknown[]) => PromiseLike<unknown>;
  };
  workspace: {
    getConfiguration: (section: string) => WorkspaceConfiguration;
  };
};

type ProxyManager = Pick<ProxyManagerService, 'hasConfiguration' | 'getState' | 'toggleProxy'>;

type NotificationService = Pick<
  NotificationServiceService,
  'showSuccess' | 'showWarning' | 'showError'
>;

type RefreshUi = () => Promise<void>;

const ACTION_CONFIGURE_NOW: NotificationAction = { id: 'configure', title: 'Configure Now' };
const ACTION_CANCEL: NotificationAction = { id: 'cancel', title: 'Cancel' };
const ACTION_DISABLE_PROXY: NotificationAction = { id: 'disableProxy', title: 'Disable Proxy' };
const ACTION_OPEN_SETTINGS: NotificationAction = { id: 'openSettings', title: 'Open Settings' };

/**
 * Toggles the proxy on/off.
 *
 * If `proxyToggler.confirmBeforeToggle` is enabled, the user is prompted before toggling.
 *
 * @param vscodeApi VS Code API surface used for commands execution and settings reads.
 * @param proxyManager ProxyManager facade.
 * @param notificationService Notification helper (localized UI).
 * @param refreshUi Callback to refresh status bar and context keys.
 * @returns void
 * @throws {Error} If VS Code command execution fails unexpectedly.
 * @example
 * ```ts
 * await toggleProxyCommand(vscode, proxyManager, notifications, refreshUi);
 * ```
 */
export async function toggleProxyCommand(
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
      const choice = await notificationService.showSuccess('Proxy enabled', ACTION_DISABLE_PROXY);
      if (choice === ACTION_DISABLE_PROXY.id) {
        await vscodeApi.commands.executeCommand('proxyToggler.disable');
      }
    } else {
      await notificationService.showSuccess('Proxy disabled');
    }
  } catch (error: unknown) {
    await showToggleError(vscodeApi, notificationService, error);
  }
}

function shouldConfirmToggle(vscodeApi: VscodeApi): boolean {
  const configuration = vscodeApi.workspace.getConfiguration(SETTINGS_SECTION);
  return configuration.get<boolean>(CONFIRM_BEFORE_TOGGLE_SETTING, false);
}

async function confirmToggle(
  notificationService: NotificationService,
  isEnabled: boolean
): Promise<boolean> {
  const actionLabel = isEnabled ? 'Disable' : 'Enable';
  const message = isEnabled ? 'Disable proxy?' : 'Enable proxy?';

  const confirmAction: NotificationAction = { id: 'confirm', title: actionLabel };
  const choice = await notificationService.showWarning(message, confirmAction, ACTION_CANCEL);
  return choice === confirmAction.id;
}

async function showToggleError(
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

  await notificationService.showError('Failed to toggle proxy.');
}
