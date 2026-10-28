import type { ProxyManager } from '../core/proxy-manager';
import type { VscodeApi } from '../vscode/api';
import type { NotificationAction, Notifier } from '../vscode/notification-service';
import { type ProxyChange, turnOnOrOff } from './proxy-change';

const ACTION_CANCEL: NotificationAction = { id: 'cancel', title: 'Cancel' };

export async function toggleProxyCommand(
  vscodeApi: Pick<VscodeApi, 'workspace'>,
  proxyManager: Pick<ProxyManager, 'getState'>,
  notificationService: Notifier,
  change: ProxyChange
): Promise<void> {
  if (!shouldConfirmToggle(vscodeApi)) {
    await change((manager) => manager.toggleProxy());
    return;
  }

  // A confirmed toggle does what its button said: another window may change the state while
  // the prompt is open.
  const turnOn = !proxyManager.getState().isEnabled;
  if (await confirmToggle(notificationService, turnOn)) {
    await turnOnOrOff(change, turnOn);
  }
}

function shouldConfirmToggle(vscodeApi: Pick<VscodeApi, 'workspace'>): boolean {
  return vscodeApi.workspace
    .getConfiguration('proxyToggler')
    .get<boolean>('confirmBeforeToggle', false);
}

// Only the toggle asks first: confirmBeforeToggle guards the status bar toggle and this command.
async function confirmToggle(notificationService: Notifier, turnOn: boolean): Promise<boolean> {
  const confirmAction: NotificationAction = {
    id: 'confirm',
    title: turnOn ? 'Turn On' : 'Turn Off'
  };
  const message = turnOn ? 'Turn proxy on?' : 'Turn proxy off?';

  const choice = await notificationService.showWarning(message, confirmAction, ACTION_CANCEL);
  return choice === confirmAction.id;
}
