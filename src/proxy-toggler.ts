import { addProfileCommand } from './commands/add-profile';
import { checkSettingsDrift } from './commands/check-settings-drift';
import { COMMANDS, CONTEXT_KEYS } from './commands/command-ids';
import { disableProxyCommand } from './commands/disable-proxy';
import { enableProxyCommand } from './commands/enable-proxy';
import { warnAboutHiddenProfiles } from './commands/profile-warning';
import { announceRemovedCredentials, removeStoredCredentials } from './commands/stored-credentials';
import { switchProfileCommand } from './commands/switcher';
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
import { whenSettled } from './vscode/settle';
import { StatusBarController } from './vscode/status-bar-controller';

// Returned from activate(); integration tests read it through the extension's exports.
export type ProxyTogglerApi = {
  getState(): ToggleState;
  refreshUi(): Promise<void>;
  getStatusBarText(): string | undefined;
  getStatusBarAccessibilityLabel(): string | undefined;
};

// How long the settings must stay unchanged before a window trusts what it reads after writes
// that other windows may make at the same time, such as at start-up.
const SETTLE_MS = 2000;

export function createProxyToggler(
  vscodeApi: VscodeApi,
  context: ExtensionContext
): ProxyTogglerApi {
  const logger = vscodeApi.window.createOutputChannel('Proxy Toggler', { log: true });
  const globalState = readYourWrites(context.globalState);
  const keychainService = new KeychainService(context.secrets);
  const proxyManager = new ProxyManager(
    globalState,
    createHttpSettings(vscodeApi),
    createProfilesSetting(vscodeApi)
  );
  const notificationService = new NotificationService(vscodeApi);
  const statusBarController = new StatusBarController(
    vscodeApi,
    COMMANDS.toggle,
    COMMANDS.switchProfile
  );

  context.subscriptions.push(logger, statusBarController);

  const refreshUi = async (): Promise<void> => {
    const state = proxyManager.getState();
    statusBarController.updateState(state, proxyManager.getProfiles().length);
    await vscodeApi.commands.executeCommand(
      'setContext',
      CONTEXT_KEYS.hasConfiguration,
      state.hasConfiguration
    );
    await vscodeApi.commands.executeCommand('setContext', CONTEXT_KEYS.isEnabled, state.isEnabled);
  };

  runInBackground(logger, 'Status bar refresh', refreshUi);
  // Warnings and one-time notices appear in the focused window, or else in the next window to
  // gain focus (ADR 0004).
  const announceIfFocused = async (): Promise<void> => {
    if (vscodeApi.window.state.focused) {
      await announceRemovedCredentials(globalState, notificationService);
    }
  };
  const warnIfFocused = async (): Promise<void> => {
    if (vscodeApi.window.state.focused) {
      const hidden = proxyManager.getHiddenProfiles();
      await warnAboutHiddenProfiles(vscodeApi, globalState, notificationService, hidden);
    }
  };
  // Hand edits and Settings Sync can change the profiles at any time.
  context.subscriptions.push(
    vscodeApi.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('proxyToggler.profiles')) {
        runInBackground(logger, 'Status bar refresh', refreshUi);
        runInBackground(logger, 'Hidden profiles warning', warnIfFocused);
      }
    })
  );
  context.subscriptions.push(
    vscodeApi.window.onDidChangeWindowState(() => {
      runInBackground(logger, 'Removed credentials notice', announceIfFocused);
      runInBackground(logger, 'Hidden profiles warning', warnIfFocused);
    })
  );
  runInBackground(logger, 'Hidden profiles warning', warnIfFocused);
  runInBackground(logger, 'Stored credentials removal', async () => {
    await removeStoredCredentials(keychainService, globalState);
    await announceIfFocused();
  });
  runInBackground(logger, 'Migration and drift check', async () => {
    // Migration first, so that the drift check sees the profile this VS Code Profile used in 0.1.x.
    await proxyManager.migrateSavedProxy();
    await refreshUi();
    await checkSettingsDrift(proxyManager, notificationService, refreshUi);
  });
  // A later read, once writes from other windows have landed, records the copy or makes it again.
  runInBackground(logger, 'Migration check', async () => {
    await whenSettled(vscodeApi, 'proxyToggler.profiles', SETTLE_MS);
    await proxyManager.migrateSavedProxy();
    await refreshUi();
  });

  const register = createCommandRegistrar(vscodeApi, logger, notificationService);
  context.subscriptions.push(
    // Adds the first profile; with profiles, it opens the switcher, where they are managed.
    register(COMMANDS.configure, 'Failed to configure proxy.', () =>
      proxyManager.hasConfiguration()
        ? switchProfileCommand(vscodeApi, proxyManager, notificationService, refreshUi)
        : addProfileCommand(vscodeApi, proxyManager, notificationService, refreshUi)
    ),
    register(COMMANDS.enable, 'Failed to enable proxy.', () =>
      enableProxyCommand(vscodeApi, proxyManager, notificationService, refreshUi)
    ),
    register(COMMANDS.disable, 'Failed to disable proxy.', () =>
      disableProxyCommand(vscodeApi, proxyManager, notificationService, refreshUi)
    ),
    register(COMMANDS.toggle, 'Failed to toggle proxy.', () =>
      toggleProxyCommand(vscodeApi, proxyManager, notificationService, refreshUi)
    ),
    // Keybindings may pass a profile name.
    register(COMMANDS.switchProfile, 'Failed to switch the proxy profile.', (name?: unknown) =>
      switchProfileCommand(vscodeApi, proxyManager, notificationService, refreshUi, name)
    )
  );

  return {
    getState: () => proxyManager.getState(),
    refreshUi,
    getStatusBarText: () => statusBarController.getText(),
    getStatusBarAccessibilityLabel: () => statusBarController.getAccessibilityLabel()
  };
}
