import type * as vscode from 'vscode';

import { configureProxyCommand } from './commands/configure-proxy';
import { disableProxyCommand } from './commands/disable-proxy';
import { enableProxyCommand } from './commands/enable-proxy';
import { toggleProxyCommand } from './commands/toggle-proxy';
import { KeychainService } from './services/keychain-service';
import { type HttpConfiguration, ProxyManager } from './services/proxy-manager';
import type { ToggleState } from './types/toggle-state';
import { NotificationService } from './ui/notification-service';
import { StatusBarController } from './ui/status-bar-controller';

export const COMMAND_CONFIGURE = 'proxyToggler.configure';
export const COMMAND_ENABLE = 'proxyToggler.enable';
export const COMMAND_DISABLE = 'proxyToggler.disable';
export const COMMAND_TOGGLE = 'proxyToggler.toggle';

const CONTEXT_HAS_CONFIGURATION = 'proxyToggler.hasConfiguration';
const CONTEXT_IS_ENABLED = 'proxyToggler.isEnabled';

type CommandHandler = () => Promise<void> | void;

type InputBoxOptions = {
  prompt: string;
  value?: string;
  placeHolder?: string;
  password?: boolean;
  ignoreFocusOut?: boolean;
  validateInput?: (value: string) => string | undefined;
};

type QuickPickItem = {
  label: string;
  description?: string;
  detail?: string;
};

type QuickPickOptions = {
  placeHolder?: string;
  ignoreFocusOut?: boolean;
};

type VscodeApi = {
  ConfigurationTarget: {
    Global: vscode.ConfigurationTarget;
  };
  StatusBarAlignment: {
    Right: vscode.StatusBarAlignment;
  };
  commands: {
    registerCommand: (command: string, callback: CommandHandler) => vscode.Disposable;
    executeCommand: (command: string, ...args: unknown[]) => PromiseLike<unknown>;
  };
  l10n: {
    t: (message: string, ...args: (string | number)[]) => string;
  };
  workspace: {
    getConfiguration: (section: string) => {
      get: <T>(section: string, defaultValue?: T) => T;
      inspect: <T>(
        section: string
      ) =>
        | { defaultValue?: T; globalValue?: T; workspaceValue?: T; workspaceFolderValue?: T }
        | undefined;
      update: (
        section: string,
        value: unknown,
        target: vscode.ConfigurationTarget
      ) => PromiseLike<void>;
    };
  };
  window: {
    showInformationMessage: (
      message: string,
      ...items: string[]
    ) => PromiseLike<string | undefined>;
    showErrorMessage: (message: string, ...items: string[]) => PromiseLike<string | undefined>;
    showWarningMessage: (message: string, ...items: string[]) => PromiseLike<string | undefined>;
    showInputBox: (options: InputBoxOptions) => Promise<string | undefined>;
    showQuickPick: <T extends QuickPickItem>(
      items: readonly T[],
      options: QuickPickOptions
    ) => Promise<T | undefined>;
    createStatusBarItem: (
      alignment: vscode.StatusBarAlignment,
      priority?: number
    ) => vscode.StatusBarItem;
  };
};

export type ProxyTogglerApi = {
  getState: () => ToggleState;
  refreshUi: () => Promise<void>;
  getStatusBarText: () => string | undefined;
  getStatusBarAccessibilityLabel: () => string | undefined;
};

export function registerCommands(
  vscodeApi: VscodeApi,
  context: vscode.ExtensionContext
): ProxyTogglerApi {
  const keychainService = new KeychainService(context.secrets);
  const httpConfiguration = createHttpConfiguration(vscodeApi);
  const proxyManager = new ProxyManager(context.globalState, keychainService, httpConfiguration);
  const notificationService = new NotificationService(vscodeApi);
  const statusBarController = new StatusBarController(vscodeApi, COMMAND_TOGGLE);
  statusBarController.initialize();

  context.subscriptions.push(keychainService, proxyManager, statusBarController);

  const refreshUi = async (): Promise<void> => {
    const state = proxyManager.getState();
    statusBarController.updateState(state);
    await vscodeApi.commands.executeCommand(
      'setContext',
      CONTEXT_HAS_CONFIGURATION,
      state.hasConfiguration
    );
    await vscodeApi.commands.executeCommand('setContext', CONTEXT_IS_ENABLED, state.isEnabled);
  };

  void refreshUi().catch(() => {});
  void detectDriftOnActivation(vscodeApi, proxyManager, notificationService, refreshUi).catch(
    () => {}
  );

  const register = (command: string, handler: () => Promise<void> | void): void => {
    context.subscriptions.push(vscodeApi.commands.registerCommand(command, handler));
  };

  register(COMMAND_CONFIGURE, async () => {
    await configureProxyCommand(vscodeApi, proxyManager, notificationService, refreshUi);
  });

  register(COMMAND_ENABLE, async () => {
    await enableProxyCommand(vscodeApi, proxyManager, notificationService, refreshUi);
  });

  register(COMMAND_DISABLE, async () => {
    await disableProxyCommand(vscodeApi, proxyManager, notificationService, refreshUi);
  });

  register(COMMAND_TOGGLE, async () => {
    await toggleProxyCommand(vscodeApi, proxyManager, notificationService, refreshUi);
  });

  return {
    getState: () => proxyManager.getState(),
    refreshUi,
    getStatusBarText: () => statusBarController.getText(),
    getStatusBarAccessibilityLabel: () => statusBarController.getAccessibilityLabel()
  };
}

export function activate(
  context: vscode.ExtensionContext,
  vscodeApi?: VscodeApi,
  importVscodeApi: () => VscodeApi = () => require('vscode') as VscodeApi
): ProxyTogglerApi {
  const resolvedVscodeApi = vscodeApi ?? importVscodeApi();
  return registerCommands(resolvedVscodeApi, context);
}

function createHttpConfiguration(vscodeApi: VscodeApi): HttpConfiguration {
  const httpConfig = vscodeApi.workspace.getConfiguration('http');

  return {
    update: async (key, value) => {
      const resolvedValue =
        key === 'noProxy' && typeof value === 'string' && shouldWriteNoProxyAsArray(httpConfig)
          ? splitNoProxyEntries(value)
          : value;

      await httpConfig.update(key, resolvedValue, vscodeApi.ConfigurationTarget.Global);
    }
  };
}

async function detectDriftOnActivation(
  vscodeApi: VscodeApi,
  proxyManager: Pick<ProxyManager, 'getSavedConfiguration' | 'getState' | 'syncToggleState'>,
  notificationService: Pick<NotificationService, 'showWarning'>,
  refreshUi: () => Promise<void>
): Promise<void> {
  const saved = proxyManager.getSavedConfiguration();
  if (!saved) {
    return;
  }

  const httpConfig = vscodeApi.workspace.getConfiguration('http');
  const proxy = httpConfig.get<string | undefined>('proxy');
  const proxyStrictSSL = httpConfig.get<boolean | undefined>('proxyStrictSSL');
  const noProxy = httpConfig.get<unknown>('noProxy');

  const matchesSaved =
    proxy === saved.proxyUrl &&
    proxyStrictSSL === saved.strictSSL &&
    normalizeNoProxyForComparison(noProxy) === normalizeNoProxyForComparison(saved.noProxy);

  if (proxyManager.getState().isEnabled === matchesSaved) {
    return;
  }

  const choice = await notificationService.showWarning(
    'VS Code proxy settings differ from Proxy Toggler state.',
    { id: 'sync', title: 'Sync' },
    { id: 'dismiss', title: 'Dismiss' }
  );

  if (choice !== 'sync') {
    return;
  }

  await proxyManager.syncToggleState(matchesSaved);
  await refreshUi();
}

function shouldWriteNoProxyAsArray(
  httpConfig: ReturnType<VscodeApi['workspace']['getConfiguration']>
): boolean {
  const inspected = httpConfig.inspect<unknown>('noProxy');
  return Array.isArray(inspected?.defaultValue);
}

function splitNoProxyEntries(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeNoProxyForComparison(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0)
      .join(',');
  }

  if (typeof value === 'string') {
    return splitNoProxyEntries(value).join(',');
  }

  return '';
}
