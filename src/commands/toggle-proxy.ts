import { KeychainError } from '../core/keychain-service';
import type { ProxyManager as ProxyManagerService } from '../core/proxy-manager';
import { ConfigurationError } from '../core/proxy-manager';
import type { VscodeApi } from '../vscode/api';
import type {
  NotificationAction,
  NotificationService as NotificationServiceService
} from '../vscode/notification-service';
import { COMMANDS } from './command-ids';

const CONFIRM_BEFORE_TOGGLE_SETTING = 'confirmBeforeToggle';
const SETTINGS_SECTION = 'proxyToggler';

type ToggleApi = Pick<VscodeApi, 'commands' | 'workspace'>;

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

export async function toggleProxyCommand(
  vscodeApi: ToggleApi,
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
      await vscodeApi.commands.executeCommand(COMMANDS.configure);
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
        await vscodeApi.commands.executeCommand(COMMANDS.disable);
      }
    } else {
      await notificationService.showSuccess('Proxy disabled');
    }
  } catch (error: unknown) {
    await showToggleError(vscodeApi, notificationService, error);
  }
}

function shouldConfirmToggle(vscodeApi: ToggleApi): boolean {
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
  vscodeApi: ToggleApi,
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
      await vscodeApi.commands.executeCommand(COMMANDS.disable);
    }
    return;
  }

  await notificationService.showError('Failed to toggle proxy.');
}
