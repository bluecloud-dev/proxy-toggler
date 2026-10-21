import type { ConfigurationChangeEvent, QuickPickItem, StatusBarAlignment } from 'vscode';

import type {
  QuickPick,
  StatusBarItem,
  VscodeApi,
  WorkspaceConfiguration
} from '../../src/vscode/api';

type MessageKind = 'info' | 'warning' | 'error';

type RecordedMessage = { kind: MessageKind; message: string; items: string[] };

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

export type FakeVscodeOptions = {
  // Answers for successive showInputBox calls. Each answer runs through validateInput, and one it
  // rejects throws: VS Code keeps the input box open, so that answer could never be submitted.
  inputs?: Array<string | undefined>;
  pick?: (items: readonly QuickPickItem[], callIndex: number) => QuickPickItem | undefined;
  // Drives each QuickPick once it shows; one left alone is dismissed.
  quickPick?: (quickPick: FakeQuickPick, callIndex: number) => void;
  // The button the user clicks for a notification; undefined means it was dismissed. A promise
  // keeps the notification open until it settles.
  answer?: (message: RecordedMessage) => string | undefined | Promise<string | undefined>;
  translate?: (message: string) => string;
  // Keyed by full setting id, for example 'http.proxy'.
  settings?: Record<string, unknown>;
  // Registered defaults by full setting id; `get` falls back to them, as VS Code does.
  defaults?: Record<string, unknown>;
  // Whether the window has focus at activation; it does unless a test says otherwise.
  focused?: boolean;
};

export type FakeVscode = VscodeApi & {
  commandHandlers: Map<string, (...args: unknown[]) => unknown>;
  // Every QuickPick shown, in order.
  quickPicks: FakeQuickPick[];
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
};

export function createFakeVscode(options: FakeVscodeOptions = {}): FakeVscode {
  const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const quickPicks: FakeQuickPick[] = [];
  const executedCommands: FakeVscode['executedCommands'] = [];
  const messages: RecordedMessage[] = [];
  const settings = new Map(Object.entries(options.settings ?? {}));
  const defaults = new Map(Object.entries(options.defaults ?? {}));
  const settingUpdates: FakeVscode['settingUpdates'] = [];
  const statusBarItems: FakeStatusBarItem[] = [];
  const logs: string[] = [];
  const inputs = [...(options.inputs ?? [])];
  let quickPickCalls = 0;
  const configurationListeners: Array<(event: ConfigurationChangeEvent) => unknown> = [];
  // VS Code fires the change event before the update that caused it resolves.
  const fireConfigurationChange = (ids: readonly string[]): void => {
    const event: ConfigurationChangeEvent = {
      affectsConfiguration: (section) =>
        ids.some((id) => id === section || id.startsWith(`${section}.`))
    };
    for (const listener of [...configurationListeners]) {
      listener(event);
    }
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
        if (settings.has(id(key))) {
          return settings.get(id(key));
        }
        return defaults.has(id(key)) ? defaults.get(id(key)) : defaultValue;
      },
      inspect: (key: string) => ({
        key: id(key),
        defaultValue: defaults.get(id(key)),
        globalValue: settings.get(id(key))
      }),
      update: async (key: string, value: unknown, target?: unknown) => {
        settingUpdates.push({ id: id(key), value, target });
        if (value === undefined) {
          settings.delete(id(key));
        } else {
          settings.set(id(key), value);
        }
        fireConfigurationChange([id(key)]);
      }
    };
    // `get` is overloaded and `inspect` is generic in VS Code's typings; one implementation
    // serves every signature.
    return configuration as WorkspaceConfiguration;
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
      fireConfigurationChange(Object.keys(values));
    },
    setFocused: (focused) => {
      windowState.focused = focused;
      for (const listener of windowStateListeners) {
        listener({ focused, active: focused });
      }
    },
    ConfigurationTarget: { Global: 1 },
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
      createQuickPick: <T extends QuickPickItem>() => createQuickPick() as unknown as QuickPick<T>,
      createStatusBarItem: (alignment, priority) => {
        const item: FakeStatusBarItem = {
          alignment,
          priority,
          text: '',
          tooltip: undefined,
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
      showInputBox: async (inputOptions) => {
        const value = inputs.shift();
        const rejection =
          value === undefined ? undefined : await inputOptions.validateInput?.(value);
        if (rejection) {
          const reason = typeof rejection === 'string' ? rejection : rejection.message;
          throw new Error(`The input box rejects the answer: ${reason}`);
        }
        return value;
      },
      showQuickPick: async <T extends QuickPickItem>(items: readonly T[]) =>
        options.pick?.(items, quickPickCalls++) as T | undefined,
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
