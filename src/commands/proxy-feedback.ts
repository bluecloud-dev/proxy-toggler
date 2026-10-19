import { KeychainError } from '../core/keychain-service';
import { ConfigurationError } from '../core/proxy-manager';
import type { VscodeApi } from '../vscode/api';
import type { NotificationAction, Notifier } from '../vscode/notification-service';
import { COMMANDS } from './command-ids';

type CommandsApi = Pick<VscodeApi, 'commands'>;

const ACTION_CONFIGURE_NOW: NotificationAction = { id: 'configure', title: 'Configure Now' };
const ACTION_DISABLE_PROXY: NotificationAction = { id: 'disableProxy', title: 'Disable Proxy' };
const ACTION_OPEN_SETTINGS: NotificationAction = { id: 'openSettings', title: 'Open Settings' };

export async function offerToConfigure(
  vscodeApi: CommandsApi,
  notificationService: Notifier
): Promise<void> {
  const choice = await notificationService.showWarning(
    'No proxy configuration found. Please configure proxy settings first.',
    ACTION_CONFIGURE_NOW
  );

  if (choice === ACTION_CONFIGURE_NOW.id) {
    await vscodeApi.commands.executeCommand(COMMANDS.configure);
  }
}

export async function announceEnabled(
  vscodeApi: CommandsApi,
  notificationService: Notifier
): Promise<void> {
  const choice = await notificationService.showSuccess('Proxy enabled', ACTION_DISABLE_PROXY);

  if (choice === ACTION_DISABLE_PROXY.id) {
    await vscodeApi.commands.executeCommand(COMMANDS.disable);
  }
}

// Shows the errors these commands can explain and rethrows the rest for the command registrar.
export async function showKnownProxyError(
  vscodeApi: CommandsApi,
  notificationService: Notifier,
  error: unknown,
  options: { offerDisable: boolean }
): Promise<void> {
  if (error instanceof KeychainError) {
    await notificationService.showError(error.toUserMessage());
    return;
  }

  if (!(error instanceof ConfigurationError)) {
    throw error;
  }

  const actions = options.offerDisable
    ? [ACTION_OPEN_SETTINGS, ACTION_DISABLE_PROXY]
    : [ACTION_OPEN_SETTINGS];
  const choice = await notificationService.showError(error.toUserMessage(), ...actions);

  if (choice === ACTION_OPEN_SETTINGS.id) {
    await vscodeApi.commands.executeCommand('workbench.action.openSettings', error.getSettingId());
  } else if (choice === ACTION_DISABLE_PROXY.id) {
    await vscodeApi.commands.executeCommand(COMMANDS.disable);
  }
}
