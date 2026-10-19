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
import { createCommandRegistrar, runInBackground } from './vscode/error-reporting';
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
  const logger = vscodeApi.window.createOutputChannel('Proxy Toggler', { log: true });
  const proxyManager = new ProxyManager(
    context.globalState,
    new KeychainService(context.secrets),
    createHttpSettings(vscodeApi)
  );
  const notificationService = new NotificationService(vscodeApi);
  const statusBarController = new StatusBarController(vscodeApi, COMMANDS.toggle);

  context.subscriptions.push(logger, statusBarController);

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

  runInBackground(logger, 'Status bar refresh', refreshUi);
  runInBackground(logger, 'Settings drift check', () =>
    checkSettingsDrift(proxyManager, notificationService, refreshUi)
  );

  const register = createCommandRegistrar(vscodeApi, logger, notificationService);
  context.subscriptions.push(
    register(COMMANDS.configure, 'Failed to configure proxy.', () =>
      configureProxyCommand(vscodeApi, proxyManager, notificationService, refreshUi)
    ),
    register(COMMANDS.enable, 'Failed to enable proxy.', () =>
      enableProxyCommand(vscodeApi, proxyManager, notificationService, refreshUi)
    ),
    register(COMMANDS.disable, 'Failed to disable proxy.', () =>
      disableProxyCommand(vscodeApi, proxyManager, notificationService, refreshUi)
    ),
    register(COMMANDS.toggle, 'Failed to toggle proxy.', () =>
      toggleProxyCommand(vscodeApi, proxyManager, notificationService, refreshUi)
    )
  );

  return {
    getState: () => proxyManager.getState(),
    refreshUi,
    getStatusBarText: () => statusBarController.getText(),
    getStatusBarAccessibilityLabel: () => statusBarController.getAccessibilityLabel()
  };
}
