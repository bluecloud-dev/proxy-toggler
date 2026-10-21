import { addProfileCommand } from './commands/add-profile';
import { checkSettingsDrift } from './commands/check-settings-drift';
import { COMMANDS, CONTEXT_KEYS } from './commands/command-ids';
import { createCredentialsNotice } from './commands/credentials-notice';
import { disableProxyCommand } from './commands/disable-proxy';
import { editProfileCommand } from './commands/edit-profile';
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

const PROXY_SETTINGS = ['http.proxy', 'http.proxyStrictSSL', 'http.noProxy'];

export function createProxyToggler(
  vscodeApi: VscodeApi,
  context: ExtensionContext
): ProxyTogglerApi {
  const logger = vscodeApi.window.createOutputChannel('Proxy Toggler', { log: true });
  const globalState = readYourWrites(context.globalState);
  const keychainService = new KeychainService(context.secrets);
  const notificationService = new NotificationService(vscodeApi);
  const proxyManager = new ProxyManager(
    globalState,
    createHttpSettings(vscodeApi),
    createProfilesSetting(vscodeApi),
    createCredentialsNotice(globalState, notificationService)
  );
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
  // Every window keeps its own record in step with the settings it manages. Only the focused
  // window re-applies an outside edit; reconcile() knows which window it runs in.
  const reconcile = async (): Promise<void> => {
    await proxyManager.reconcile({ focused: vscodeApi.window.state.focused });
    await refreshUi();
  };
  // Waits until the settings settle, so that a change made of several writes is read whole.
  let settleTimer: NodeJS.Timeout | undefined;
  const reconcileOnceSettled = (): void => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      runInBackground(logger, 'Reconciliation', reconcile);
    }, SETTLE_MS).unref();
  };
  context.subscriptions.push({ dispose: () => clearTimeout(settleTimer) });

  // Hand edits, Settings Sync, other windows and other tools can change both at any time.
  context.subscriptions.push(
    vscodeApi.workspace.onDidChangeConfiguration((event) => {
      const profilesChanged = event.affectsConfiguration('proxyToggler.profiles');
      const proxyChanged = PROXY_SETTINGS.some((id) => event.affectsConfiguration(id));
      if (!profilesChanged && !proxyChanged) {
        return;
      }

      runInBackground(logger, 'Status bar refresh', refreshUi);
      if (profilesChanged) {
        runInBackground(logger, 'Hidden profiles warning', warnIfFocused);
      }
      // A window treats its own change as done (ADR 0004).
      if (!proxyManager.isMakingOwnChange()) {
        reconcileOnceSettled();
      }
    })
  );
  context.subscriptions.push(
    vscodeApi.window.onDidChangeWindowState((windowState) => {
      runInBackground(logger, 'Removed credentials notice', announceIfFocused);
      runInBackground(logger, 'Hidden profiles warning', warnIfFocused);
      // An outside change seen while no window had focus falls to the next window to gain it.
      if (windowState.focused) {
        runInBackground(logger, 'Reconciliation', reconcile);
      }
    })
  );
  runInBackground(logger, 'Hidden profiles warning', warnIfFocused);
  runInBackground(logger, 'Stored credentials removal', async () => {
    await removeStoredCredentials(keychainService, globalState);
    await announceIfFocused();
  });
  runInBackground(logger, 'Migration and drift check', async () => {
    // Migration first, so that reconciliation and the drift check see the profile this VS Code
    // Profile used in 0.1.x.
    await proxyManager.migrateSavedProxy();
    await reconcile();
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
    // Adds the first profile, or edits the current one.
    register(COMMANDS.configure, 'Failed to configure proxy.', () => {
      const current = proxyManager.getState().currentProfile;
      return current
        ? editProfileCommand(vscodeApi, proxyManager, notificationService, refreshUi, current.name)
        : addProfileCommand(vscodeApi, proxyManager, notificationService, refreshUi);
    }),
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
