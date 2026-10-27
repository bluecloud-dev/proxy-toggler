import { ProfileApplyError } from '../core/proxy-manager';
import { ConfigurationError } from '../core/proxy-settings-writer';
import type { VscodeApi } from '../vscode/api';
import type { NotificationAction, Notifier } from '../vscode/notification-service';
import { COMMANDS } from './command-ids';

type CommandsApi = Pick<VscodeApi, 'commands'>;

// Success toasts are off unless the user asks for them: the status bar already shows the result.
export async function announceSwitch(
  vscodeApi: Pick<VscodeApi, 'workspace'>,
  notificationService: Notifier,
  message: string
): Promise<void> {
  const enabled = vscodeApi.workspace
    .getConfiguration('proxyToggler')
    .get<boolean>('showSwitchNotifications', false);
  if (enabled) {
    await notificationService.showSuccess(message);
  }
}

const ACTION_CONFIGURE_NOW: NotificationAction = { id: 'configure', title: 'Configure Now' };
const ACTION_DISABLE_PROXY: NotificationAction = { id: 'disableProxy', title: 'Turn Proxy Off' };
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

// Shows the errors these commands can explain and rethrows the rest for the command registrar.
export async function showKnownProxyError(
  vscodeApi: CommandsApi,
  notificationService: Notifier,
  error: unknown,
  options: { offerDisable: boolean }
): Promise<void> {
  const cause = error instanceof ProfileApplyError ? error.cause : error;
  if (!(cause instanceof ConfigurationError)) {
    throw error;
  }

  const actions = options.offerDisable
    ? [ACTION_OPEN_SETTINGS, ACTION_DISABLE_PROXY]
    : [ACTION_OPEN_SETTINGS];
  const message =
    error instanceof ProfileApplyError ? error.toUserMessage() : cause.toUserMessage();
  const choice = await notificationService.showError(message, ...actions);

  if (choice === ACTION_OPEN_SETTINGS.id) {
    await vscodeApi.commands.executeCommand('workbench.action.openSettings', cause.getSettingId());
  } else if (choice === ACTION_DISABLE_PROXY.id) {
    await vscodeApi.commands.executeCommand(COMMANDS.disable);
  }
}
