import type { ProxyManager } from '../core/proxy-manager';
import type { ProxyOutcome } from '../core/proxy-outcome';
import { type ConfigurationError, failedSettingWrite } from '../core/proxy-settings-writer';
import type { VscodeApi } from '../vscode/api';
import { userMessageOf } from '../vscode/error-reporting';
import {
  ACTION_OPEN_SETTINGS,
  type NotificationAction,
  type Notifier
} from '../vscode/notification-service';
import { COMMANDS } from './command-ids';

// The ProxyManager methods that change something. Commands hold only its queries, so every change
// they make through ProxyManager goes through a ProxyChange.
export type ProxyChanger = Pick<
  ProxyManager,
  | 'enableProxy'
  | 'disableProxy'
  | 'toggleProxy'
  | 'switchTo'
  | 'addProfile'
  | 'updateProfile'
  | 'deleteProfile'
>;

// `writeFailed`: a setting write failed, and the user has been told.
type Reported<O extends ProxyOutcome> = O | { kind: 'writeFailed' };

// The change makes one ProxyManager call and never waits for the user, so the extension's own
// prompts never hold up ProxyManager's queue.
export type ProxyChange = <O extends ProxyOutcome>(
  change: (manager: ProxyChanger) => Promise<O>
) => Promise<Reported<O>>;

const ACTION_CONFIGURE_NOW: NotificationAction = { id: 'configure', title: 'Configure Now' };
const ACTION_DISABLE_PROXY: NotificationAction = { id: 'disableProxy', title: 'Turn Proxy Off' };

export async function turnOnOrOff(change: ProxyChange, on: boolean): Promise<void> {
  await (on
    ? change((manager) => manager.enableProxy())
    : change((manager) => manager.disableProxy()));
}

// Runs a proxy change, refreshes the status bar whether it worked or not, then says what happened.
// It shows at most one message, and only the error when a setting write failed (ADR 0004).
export function createProxyChange(
  vscodeApi: Pick<VscodeApi, 'commands' | 'workspace'>,
  proxyManager: ProxyChanger,
  notifier: Notifier,
  refreshUi: () => Promise<void>
): ProxyChange {
  // Success toasts are off unless the user asks for them: the status bar already shows the result.
  const announce = (message: string): void => {
    const enabled = vscodeApi.workspace
      .getConfiguration('proxyToggler')
      .get<boolean>('showSwitchNotifications', false);
    if (enabled) {
      notifier.inform('success', message);
    }
  };

  const report = async (outcome: ProxyOutcome): Promise<void> => {
    switch (outcome.kind) {
      case 'on':
        announce(`Proxy Toggler turned on ${outcome.profile.name}.`);
        break;
      case 'off':
        announce(
          outcome.profile === undefined
            ? 'Proxy Toggler turned the proxy off.'
            : `Proxy Toggler turned off ${outcome.profile.name}.`
        );
        break;
      case 'deleted':
        announce(`Proxy Toggler deleted ${outcome.name}.`);
        break;
      case 'saved':
        if (outcome.renamedFrom !== undefined) {
          notifier.inform(
            'warning',
            `Renamed ${outcome.renamedFrom} to ${outcome.profile.name}. Keybindings that switch to "${outcome.renamedFrom}" by name stop working.`
          );
        }
        break;
      case 'gone':
        notifier.inform(
          'warning',
          outcome.change === 'delete'
            ? `${outcome.name} was already deleted, in another window or through Settings Sync.`
            : `No proxy profile is named "${outcome.name}". The list may have changed in another window or through Settings Sync.`
        );
        break;
      case 'notConfigured':
        await offerToConfigure();
        break;
      // The command that asked for the name asks again.
      case 'nameTaken':
        break;
      default:
        outcome satisfies never;
    }
  };

  const offerToConfigure = async (): Promise<void> => {
    const choice = await notifier.showWarning(
      'No proxy configuration found. Please configure proxy settings first.',
      ACTION_CONFIGURE_NOW
    );
    if (choice === ACTION_CONFIGURE_NOW.id) {
      await vscodeApi.commands.executeCommand(COMMANDS.configure);
    }
  };

  const explain = async (error: unknown, failure: ConfigurationError): Promise<void> => {
    // Turning the proxy off is a way out only when turning it on failed.
    const actions =
      failure.operation === 'enable'
        ? [ACTION_OPEN_SETTINGS, ACTION_DISABLE_PROXY]
        : [ACTION_OPEN_SETTINGS];
    const choice = await notifier.showError(
      userMessageOf(error) ?? failure.toUserMessage(),
      ...actions
    );

    if (choice === ACTION_OPEN_SETTINGS.id) {
      await vscodeApi.commands.executeCommand(
        'workbench.action.openSettings',
        failure.getSettingId()
      );
    } else if (choice === ACTION_DISABLE_PROXY.id) {
      await vscodeApi.commands.executeCommand(COMMANDS.disable);
    }
  };

  return async <O extends ProxyOutcome>(
    change: (manager: ProxyChanger) => Promise<O>
  ): Promise<Reported<O>> => {
    let outcome: O;
    try {
      outcome = await change(proxyManager);
    } catch (error: unknown) {
      await refreshUi();
      const failure = failedSettingWrite(error);
      if (!failure) {
        throw error;
      }
      await explain(error, failure);
      return { kind: 'writeFailed' };
    }
    await refreshUi();
    await report(outcome);
    return outcome;
  };
}
