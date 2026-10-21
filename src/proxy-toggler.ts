import { checkSettingsDrift } from './commands/check-settings-drift';
import { COMMANDS, CONTEXT_KEYS } from './commands/command-ids';
import { configureProxyCommand } from './commands/configure-proxy';
import { disableProxyCommand } from './commands/disable-proxy';
import { enableProxyCommand } from './commands/enable-proxy';
import { announceRemovedCredentials, removeStoredCredentials } from './commands/stored-credentials';
import { toggleProxyCommand } from './commands/toggle-proxy';
import { KeychainService } from './core/keychain-service';
import type { ToggleState } from './core/proxy-configuration';
import { ProxyManager } from './core/proxy-manager';
import type { ExtensionContext, VscodeApi } from './vscode/api';
import { createCommandRegistrar, runInBackground } from './vscode/error-reporting';
import { createHttpSettings } from './vscode/http-settings';
import { NotificationService } from './vscode/notification-service';
import { createProfilesSetting } from './vscode/profiles-setting';
import { readYourWrites } from './vscode/read-your-writes-memento';
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
  const globalState = readYourWrites(context.globalState);
  const keychainService = new KeychainService(context.secrets);
  const proxyManager = new ProxyManager(
    globalState,
    keychainService,
    createHttpSettings(vscodeApi),
    createProfilesSetting(vscodeApi)
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
  // Hand edits and Settings Sync can add or remove profiles at any time.
  context.subscriptions.push(
    vscodeApi.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('proxyToggler.profiles')) {
        runInBackground(logger, 'Status bar refresh', refreshUi);
      }
    })
  );
  // One-time notices appear in a focused window, so the user sees them (ADR 0004).
  const announceIfFocused = async (): Promise<void> => {
    if (vscodeApi.window.state.focused) {
      await announceRemovedCredentials(globalState, notificationService);
    }
  };
  context.subscriptions.push(
    vscodeApi.window.onDidChangeWindowState(() => {
      runInBackground(logger, 'Removed credentials notice', announceIfFocused);
    })
  );
  runInBackground(logger, 'Stored credentials removal', async () => {
    await removeStoredCredentials(keychainService, globalState);
    await announceIfFocused();
  });
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
