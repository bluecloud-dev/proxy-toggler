import { checkSettingsDrift } from './commands/check-settings-drift';
import { COMMANDS, CONTEXT_KEYS } from './commands/command-ids';
import { configureProxyCommand } from './commands/configure-proxy';
import { disableProxyCommand } from './commands/disable-proxy';
import { enableProxyCommand } from './commands/enable-proxy';
import { toggleProxyCommand } from './commands/toggle-proxy';
import { KeychainService } from './core/keychain-service';
import type { ToggleState } from './core/proxy-configuration';
import { ProxyManager } from './core/proxy-manager';
import type { ExtensionContext, VscodeApi } from './vscode/api';
import { createHttpSettings } from './vscode/http-settings';
import { NotificationService } from './vscode/notification-service';
import { StatusBarController } from './vscode/status-bar-controller';

// Returned from activate(); integration tests read it through the extension's exports.
export type ProxyTogglerApi = {
  getState(): ToggleState;
  refreshUi(): Promise<void>;
  getStatusBarText(): string | undefined;
  getStatusBarAccessibilityLabel(): string | undefined;
};

export function createProxyToggler(
  vscodeApi: VscodeApi,
  context: ExtensionContext
): ProxyTogglerApi {
  const keychainService = new KeychainService(context.secrets);
  const proxyManager = new ProxyManager(
    context.globalState,
    keychainService,
    createHttpSettings(vscodeApi)
  );
  const notificationService = new NotificationService(vscodeApi);
  const statusBarController = new StatusBarController(vscodeApi, COMMANDS.toggle);

  context.subscriptions.push(keychainService, proxyManager, statusBarController);

  const refreshUi = async (): Promise<void> => {
    const state = proxyManager.getState();
    statusBarController.updateState(state);
    await vscodeApi.commands.executeCommand(
      'setContext',
      CONTEXT_KEYS.hasConfiguration,
      state.hasConfiguration
    );
    await vscodeApi.commands.executeCommand('setContext', CONTEXT_KEYS.isEnabled, state.isEnabled);
  };

  void refreshUi().catch(() => {});
  void checkSettingsDrift(proxyManager, notificationService, refreshUi).catch(() => {});

  const register = (command: string, handler: () => Promise<void>): void => {
    context.subscriptions.push(vscodeApi.commands.registerCommand(command, handler));
  };

  register(COMMANDS.configure, () =>
    configureProxyCommand(vscodeApi, proxyManager, notificationService, refreshUi)
  );
  register(COMMANDS.enable, () =>
    enableProxyCommand(vscodeApi, proxyManager, notificationService, refreshUi)
  );
  register(COMMANDS.disable, () =>
    disableProxyCommand(vscodeApi, proxyManager, notificationService, refreshUi)
  );
  register(COMMANDS.toggle, () =>
    toggleProxyCommand(vscodeApi, proxyManager, notificationService, refreshUi)
  );

  return {
    getState: () => proxyManager.getState(),
    refreshUi,
    getStatusBarText: () => statusBarController.getText(),
    getStatusBarAccessibilityLabel: () => statusBarController.getAccessibilityLabel()
  };
}
