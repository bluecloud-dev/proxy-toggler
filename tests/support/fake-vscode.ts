import type { ConfigurationChangeEvent, QuickPickItem, StatusBarAlignment } from 'vscode';

import type { StatusBarItem, VscodeApi, WorkspaceConfiguration } from '../../src/vscode/api';

type MessageKind = 'info' | 'warning' | 'error';

type RecordedMessage = { kind: MessageKind; message: string; items: string[] };

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
  commandHandlers: Map<string, () => unknown>;
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
  const commandHandlers = new Map<string, () => unknown>();
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

  return {
    commandHandlers,
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
    l10n: { t: options.translate ?? ((message) => message) },
    window: {
      createOutputChannel: () => ({
        error: (message: string | Error, ...args: unknown[]) => {
          logs.push([message, ...args].map(String).join(' '));
        },
        dispose: () => undefined
      }),
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
