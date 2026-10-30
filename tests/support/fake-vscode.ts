import type { ConfigurationChangeEvent, QuickPickItem, StatusBarAlignment } from 'vscode';

import type {
  InputBox,
  QuickPick,
  StatusBarItem,
  VscodeApi,
  WorkspaceConfiguration
} from '../../src/vscode/api';

type MessageKind = 'info' | 'warning' | 'error';

type RecordedMessage = { kind: MessageKind; message: string; items: string[] };

// An InputBox that a test drives: submit() types a value and presses Enter, back() presses the
// Back button, dismiss() is Escape.
export type FakeInputBox = InputBox & {
  submit(value?: string): void;
  back(): void;
  dismiss(): void;
};

// A QuickPick that a test drives: accept() is Enter, dismiss() is Escape.
export type FakeQuickPick = QuickPick<QuickPickItem> & {
  accept(item?: QuickPickItem): void;
  dismiss(): void;
};

type FakeStatusBarItem = StatusBarItem & {
  alignment: StatusBarAlignment;
  priority: number;
  disposeCalls: number;
};

// What the windows of one VS Code share: settings, and the change events every window hears.
export type FakeHost = {
  settings: Map<string, unknown>;
  windows: Array<(ids: readonly string[]) => void>;
};

export function createFakeHost(settings: Record<string, unknown> = {}): FakeHost {
  return { settings: new Map(Object.entries(settings)), windows: [] };
}

// A remote machine that remote windows connect to: its type, as vscode.env.remoteName gives it,
// its own settings (Machine/settings.json), and the windows that watch them.
export type FakeRemote = {
  name: string;
  settings: Map<string, unknown>;
  windows: Array<(ids: readonly string[]) => void>;
};

export function createFakeRemote(name: string, settings: Record<string, unknown> = {}): FakeRemote {
  return { name, settings: new Map(Object.entries(settings)), windows: [] };
}

// The remote sides that use this computer's proxy settings unless the remote machine's settings
// say otherwise (http.useLocalProxyConfiguration).
const USES_LOCAL_PROXY_BY_DEFAULT = new Set(['wsl', 'dev-container']);

// ConfigurationTarget.Workspace.
const WORKSPACE_TARGET = 2;

export type FakeVscodeOptions = {
  // Another window of the same VS Code; by default each fake is a VS Code of its own.
  host?: FakeHost;
  // Makes this a remote window on that machine, with the extension on the remote side.
  remote?: FakeRemote;
  // Whether VS Code hands the remote side this computer's http.* values until they next change,
  // while the remote machine's settings hold none (TESTING.md, "Remote windows", result 1).
  remoteSeesLocalProxy?: boolean;
  // Drives each QuickPick once it shows; one left alone is dismissed.
  quickPick?: (quickPick: FakeQuickPick, callIndex: number) => void;
  // Drives each InputBox once it shows; one left alone is dismissed.
  inputBox?: (inputBox: FakeInputBox, callIndex: number) => void;
  // The button the user clicks for a notification; undefined means it was dismissed. A promise
  // keeps the notification open until it settles.
  answer?: (message: RecordedMessage) => string | undefined | Promise<string | undefined>;
  translate?: (message: string) => string;
  // Keyed by full setting id, for example 'http.proxy'.
  settings?: Record<string, unknown>;
  // Registered defaults by full setting id; `get` falls back to them, as VS Code does.
  defaults?: Record<string, unknown>;
  // The open folder's settings by full setting id; without them, no folder is open.
  workspace?: Record<string, unknown>;
  // Whether the window has focus at activation; it does unless a test says otherwise.
  focused?: boolean;
};

export type FakeVscode = VscodeApi & {
  commandHandlers: Map<string, (...args: unknown[]) => unknown>;
  // Every QuickPick and InputBox shown, in order.
  quickPicks: FakeQuickPick[];
  inputBoxes: FakeInputBox[];
  // Everything written to the extension's log channel, one string per call.
  logs: string[];
  executedCommands: Array<{ command: string; args: unknown[] }>;
  messages: RecordedMessage[];
  settings: Map<string, unknown>;
  settingUpdates: Array<{ id: string; value: unknown; target: unknown }>;
  statusBarItems: FakeStatusBarItem[];
  // Moves focus to or away from the window and tells the extension, as VS Code does.
  setFocused(focused: boolean): void;
  // Changes settings from outside the extension, such as a hand edit, and tells the extension.
  changeSettings(values: Record<string, unknown>): void;
  // The same for the remote machine's settings of a remote window.
  changeRemoteSettings(values: Record<string, unknown>): void;
  // The same for the open folder's settings.
  changeWorkspaceSettings(values: Record<string, unknown>): void;
  workspaceSettings: Map<string, unknown> | undefined;
};

export function createFakeVscode(options: FakeVscodeOptions = {}): FakeVscode {
  const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const quickPicks: FakeQuickPick[] = [];
  const inputBoxes: FakeInputBox[] = [];
  const backButton = { iconPath: { id: 'arrow-left' } };
  const executedCommands: FakeVscode['executedCommands'] = [];
  const messages: RecordedMessage[] = [];
  const host = options.host ?? createFakeHost();
  for (const [id, value] of Object.entries(options.settings ?? {})) {
    host.settings.set(id, value);
  }
  const settings = host.settings;
  const defaults = new Map(Object.entries(options.defaults ?? {}));
  const workspaceSettings = options.workspace && new Map(Object.entries(options.workspace));
  const settingUpdates: FakeVscode['settingUpdates'] = [];
  const statusBarItems: FakeStatusBarItem[] = [];
  const logs: string[] = [];
  const configurationListeners: Array<(event: ConfigurationChangeEvent) => unknown> = [];
  const remote = options.remote;
  let remoteSeesLocalProxy = options.remoteSeesLocalProxy ?? false;
  const notify = (ids: readonly string[]): void => {
    const event: ConfigurationChangeEvent = {
      affectsConfiguration: (section) =>
        ids.some((id) => id === section || id.startsWith(`${section}.`))
    };
    for (const listener of [...configurationListeners]) {
      listener(event);
    }
  };
  // Every window watches this computer's settings; a change to http.* ends the start-up race.
  host.windows.push((ids) => {
    if (ids.some((id) => id.startsWith('http.'))) {
      remoteSeesLocalProxy = false;
    }
    notify(ids);
  });
  // A remote window also watches its remote machine's settings.
  remote?.windows.push(notify);
  // VS Code fires the change event, in every window that watches the changed file, before the
  // update that caused it resolves.
  const fireConfigurationChange = (
    ids: readonly string[],
    windows: ReadonlyArray<(ids: readonly string[]) => void>
  ): void => {
    for (const window of [...windows]) {
      window(ids);
    }
  };
  // In a remote window, http.* are machine-scoped, read from and written to the remote
  // machine's settings, while its remote side keeps its own proxy settings. Every other setting,
  // and http.* otherwise, belongs to this computer (docs/design/v0.2.0-research.md, 4.1 to 4.3).
  const usesLocalProxy = (): boolean => {
    const value = remote?.settings.get('http.useLocalProxyConfiguration');
    return typeof value === 'boolean' ? value : USES_LOCAL_PROXY_BY_DEFAULT.has(remote?.name ?? '');
  };
  const isMachineScoped = (id: string): boolean =>
    remote !== undefined &&
    (id === 'http.useLocalProxyConfiguration' || (id.startsWith('http.') && !usesLocalProxy()));
  const defaultOf = (id: string, fallback?: unknown): unknown => {
    if (remote && id === 'http.useLocalProxyConfiguration') {
      return USES_LOCAL_PROXY_BY_DEFAULT.has(remote.name);
    }
    return defaults.has(id) ? defaults.get(id) : fallback;
  };
  // The user-level value in effect, and whether the start-up race supplied it.
  const userValue = (id: string): unknown => {
    if (!remote || !isMachineScoped(id)) {
      return settings.get(id);
    }
    if (remote.settings.has(id)) {
      return remote.settings.get(id);
    }
    return remoteSeesLocalProxy ? settings.get(id) : undefined;
  };
  const windowState = { focused: options.focused ?? true };
  const windowStateListeners: Array<(state: { focused: boolean; active: boolean }) => unknown> = [];

  const showMessage =
    (kind: MessageKind) =>
    async (message: string, ...items: string[]): Promise<string | undefined> => {
      const recorded = { kind, message, items };
      messages.push(recorded);
      return options.answer?.(recorded);
    };

  const getConfiguration = (section: string): WorkspaceConfiguration => {
    const id = (key: string): string => `${section}.${key}`;
    const configuration = {
      get: (key: string, defaultValue?: unknown) => {
        const value = workspaceSettings?.has(id(key))
          ? workspaceSettings.get(id(key))
          : userValue(id(key));
        return value === undefined ? defaultOf(id(key), defaultValue) : value;
      },
      // globalLocalValue and globalRemoteValue are runtime fields that vscode.d.ts omits.
      inspect: (key: string) => ({
        key: id(key),
        defaultValue: defaultOf(id(key)),
        globalLocalValue: settings.get(id(key)),
        globalRemoteValue: isMachineScoped(id(key)) ? remote?.settings.get(id(key)) : undefined,
        globalValue: userValue(id(key)),
        workspaceValue: workspaceSettings?.get(id(key))
      }),
      update: async (key: string, value: unknown, target?: unknown) => {
        settingUpdates.push({ id: id(key), value, target });
        if (target === WORKSPACE_TARGET) {
          if (!workspaceSettings) {
            throw new Error(
              'Unable to write to Workspace Settings because no workspace is opened.'
            );
          }
          setOrDelete(workspaceSettings, id(key), value);
          notify([id(key)]);
          return;
        }
        // A key that the remote machine's settings already hold is written there even when it
        // belongs to this computer, and then changes nothing (research 4.3, lab check 2).
        const onRemote =
          remote !== undefined && (isMachineScoped(id(key)) || remote.settings.has(id(key)));
        const layer = onRemote && remote ? remote.settings : settings;
        if (value === undefined) {
          layer.delete(id(key));
        } else {
          layer.set(id(key), value);
        }
        fireConfigurationChange([id(key)], onRemote && remote ? remote.windows : host.windows);
      }
    };
    // `get` is overloaded and `inspect` is generic in VS Code's typings; one implementation
    // serves every signature.
    return configuration as WorkspaceConfiguration;
  };

  const createInputBox = (): FakeInputBox => {
    const accepted = emitter<void>();
    const hidden = emitter<void>();
    const changed = emitter<string>();
    const triggered = emitter<{ iconPath: unknown }>();
    let open = false;
    const close = (): void => {
      if (open) {
        open = false;
        hidden.fire();
      }
    };
    const inputBox: FakeInputBox = {
      value: '',
      title: undefined,
      prompt: undefined,
      placeholder: undefined,
      step: undefined,
      totalSteps: undefined,
      buttons: [],
      validationMessage: undefined,
      ignoreFocusOut: false,
      onDidAccept: accepted.event,
      onDidHide: hidden.event,
      onDidChangeValue: changed.event,
      onDidTriggerButton: triggered.event as InputBox['onDidTriggerButton'],
      show: () => {
        open = true;
        const index = inputBoxes.push(inputBox) - 1;
        setImmediate(() => {
          if (options.inputBox) {
            options.inputBox(inputBox, index);
          } else {
            inputBox.dismiss();
          }
        });
      },
      hide: close,
      dispose: close,
      submit: (value) => {
        if (value !== undefined) {
          inputBox.value = value;
          changed.fire(value);
        }
        accepted.fire();
      },
      back: () => {
        triggered.fire(backButton);
      },
      dismiss: close
    };
    return inputBox;
  };

  const createQuickPick = (): FakeQuickPick => {
    const accepted = emitter<void>();
    const hidden = emitter<void>();
    let open = false;
    const close = (): void => {
      if (open) {
        open = false;
        hidden.fire();
      }
    };
    const quickPick: FakeQuickPick = {
      items: [],
      activeItems: [],
      selectedItems: [],
      title: undefined,
      placeholder: undefined,
      matchOnDescription: false,
      onDidAccept: accepted.event,
      onDidHide: hidden.event,
      show: () => {
        open = true;
        const index = quickPicks.push(quickPick) - 1;
        // The extension attaches its listeners before VS Code takes any input.
        setImmediate(() => {
          if (options.quickPick) {
            options.quickPick(quickPick, index);
          } else {
            quickPick.dismiss();
          }
        });
      },
      hide: close,
      dispose: close,
      accept: (item) => {
        const chosen = item ?? quickPick.activeItems[0];
        quickPick.selectedItems = chosen ? [chosen] : [];
        accepted.fire();
      },
      dismiss: close
    };
    return quickPick;
  };

  return {
    commandHandlers,
    quickPicks,
    inputBoxes,
    logs,
    executedCommands,
    messages,
    settings,
    settingUpdates,
    statusBarItems,
    changeSettings: (values) => {
      for (const [id, value] of Object.entries(values)) {
        if (value === undefined) {
          settings.delete(id);
        } else {
          settings.set(id, value);
        }
      }
      fireConfigurationChange(Object.keys(values), host.windows);
    },
    changeWorkspaceSettings: (values) => {
      if (!workspaceSettings) {
        throw new Error('Only a window with a folder open has workspace settings.');
      }
      for (const [id, value] of Object.entries(values)) {
        setOrDelete(workspaceSettings, id, value);
      }
      notify(Object.keys(values));
    },
    workspaceSettings,
    changeRemoteSettings: (values) => {
      if (!remote) {
        throw new Error('Only a remote window has remote settings.');
      }
      for (const [id, value] of Object.entries(values)) {
        if (value === undefined) {
          remote.settings.delete(id);
        } else {
          remote.settings.set(id, value);
        }
      }
      fireConfigurationChange(Object.keys(values), remote.windows);
    },
    setFocused: (focused) => {
      windowState.focused = focused;
      for (const listener of windowStateListeners) {
        listener({ focused, active: focused });
      }
    },
    ConfigurationTarget: { Global: 1, Workspace: WORKSPACE_TARGET },
    env: { remoteName: remote?.name },
    ProgressLocation: { Notification: 15 },
    QuickInputButtons: { Back: backButton },
    ThemeColor: class {
      constructor(public readonly id: string) {}
    },
    QuickPickItemKind: { Separator: -1 },
    StatusBarAlignment: { Right: 2 },
    commands: {
      registerCommand: (command, callback) => {
        commandHandlers.set(command, callback);
        return { dispose: () => undefined };
      },
      executeCommand: async (command, ...args) => {
        executedCommands.push({ command, args });
        return undefined;
      }
    },
    // Fills {0}, {1}... with the arguments, as VS Code does after translating.
    l10n: {
      t: (message, ...args) =>
        (options.translate ?? ((text: string) => text))(message).replace(
          /\{(\d+)\}/g,
          (placeholder, index: string) => String(args[Number(index)] ?? placeholder)
        )
    },
    window: {
      createOutputChannel: () => ({
        error: (message: string | Error, ...args: unknown[]) => {
          logs.push([message, ...args].map(String).join(' '));
        },
        dispose: () => undefined
      }),
      createInputBox,
      createQuickPick: <T extends QuickPickItem>() => createQuickPick() as unknown as QuickPick<T>,
      createStatusBarItem: (alignment, priority) => {
        const item: FakeStatusBarItem = {
          alignment,
          priority,
          text: '',
          tooltip: undefined,
          backgroundColor: undefined,
          command: undefined,
          accessibilityInformation: undefined,
          disposeCalls: 0,
          show: () => undefined,
          dispose: () => {
            item.disposeCalls += 1;
          }
        };
        statusBarItems.push(item);
        return item;
      },
      showErrorMessage: showMessage('error'),
      showInformationMessage: showMessage('info'),
      showWarningMessage: showMessage('warning'),
      withProgress: async (_options, task) => task(),
      state: windowState,
      onDidChangeWindowState: (listener) => {
        windowStateListeners.push(listener);
        return {
          dispose: () => {
            windowStateListeners.splice(windowStateListeners.indexOf(listener), 1);
          }
        };
      }
    },
    workspace: {
      workspaceFolders: workspaceSettings && [{ name: 'project' }],
      getConfiguration,
      onDidChangeConfiguration: (listener) => {
        configurationListeners.push(listener);
        return {
          dispose: () => {
            configurationListeners.splice(configurationListeners.indexOf(listener), 1);
          }
        };
      }
    }
  };
}

function setOrDelete(layer: Map<string, unknown>, id: string, value: unknown): void {
  if (value === undefined) {
    layer.delete(id);
  } else {
    layer.set(id, value);
  }
}

// Makes every settings update reject, as when policy manages the settings.
export function failSettingWrites(vscode: FakeVscode): void {
  const { workspace } = vscode;
  vscode.workspace = {
    ...workspace,
    getConfiguration: (section) => ({
      ...workspace.getConfiguration(section),
      update: () => Promise.reject(new Error('managed by policy'))
    })
  };
}

// A minimal vscode.Event: listeners added with `event`, called by `fire`.
function emitter<T>(): {
  event: (listener: (value: T) => unknown) => { dispose(): void };
  fire(value: T): void;
} {
  const listeners: Array<(value: T) => unknown> = [];
  return {
    event: (listener) => {
      listeners.push(listener);
      return {
        dispose: () => {
          listeners.splice(listeners.indexOf(listener), 1);
        }
      };
    },
    fire: (value) => {
      for (const listener of [...listeners]) {
        listener(value);
      }
    }
  };
}
