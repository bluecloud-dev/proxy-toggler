import type { ProxyManager } from '../core/proxy-manager';
import type { VscodeApi } from '../vscode/api';
import type { NotificationAction, Notifier } from '../vscode/notification-service';
import { announceSwitch, offerToConfigure, showKnownProxyError } from './proxy-feedback';

const ACTION_CANCEL: NotificationAction = { id: 'cancel', title: 'Cancel' };

export async function toggleProxyCommand(
  vscodeApi: Pick<VscodeApi, 'commands' | 'workspace'>,
  proxyManager: Pick<
    ProxyManager,
    'disableProxy' | 'enableProxy' | 'hasConfiguration' | 'getState' | 'toggleProxy'
  >,
  notificationService: Notifier,
  refreshUi: () => Promise<void>
): Promise<void> {
  if (!proxyManager.hasConfiguration()) {
    await offerToConfigure(vscodeApi, notificationService);
    return;
  }

  // A confirmed toggle does what its button said: another window may change the state while
  // the prompt is open.
  let turnOn: boolean | undefined;
  if (shouldConfirmToggle(vscodeApi)) {
    turnOn = !proxyManager.getState().isEnabled;
    if (!(await confirmToggle(notificationService, turnOn))) {
      return;
    }
  }

  try {
    const isEnabled = await turnProxy(proxyManager, turnOn);
    await refreshUi();
    const name = proxyManager.getState().currentProfile?.name ?? '';
    await announceSwitch(
      vscodeApi,
      notificationService,
      isEnabled ? `Proxy Toggler turned on ${name}.` : `Proxy Toggler turned off ${name}.`
    );
  } catch (error: unknown) {
    await showKnownProxyError(vscodeApi, notificationService, error, { offerDisable: true });
  }
}

function shouldConfirmToggle(vscodeApi: Pick<VscodeApi, 'workspace'>): boolean {
  return vscodeApi.workspace
    .getConfiguration('proxyToggler')
    .get<boolean>('confirmBeforeToggle', false);
}

// Turns the proxy on or off as asked, or toggles it; resolves with whether it is on.
async function turnProxy(
  proxyManager: Pick<ProxyManager, 'disableProxy' | 'enableProxy' | 'toggleProxy'>,
  turnOn: boolean | undefined
): Promise<boolean> {
  if (turnOn === undefined) {
    return proxyManager.toggleProxy();
  }
  await (turnOn ? proxyManager.enableProxy() : proxyManager.disableProxy());
  return turnOn;
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
