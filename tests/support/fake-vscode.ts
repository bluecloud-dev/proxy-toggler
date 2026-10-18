import type { QuickPickItem, StatusBarAlignment } from 'vscode';

import type { StatusBarItem, VscodeApi, WorkspaceConfiguration } from '../../src/vscode/api';

type MessageKind = 'info' | 'warning' | 'error';

type RecordedMessage = { kind: MessageKind; message: string; items: string[] };

type FakeStatusBarItem = StatusBarItem & {
  alignment: StatusBarAlignment;
  priority: number;
  disposeCalls: number;
};

export type FakeVscodeOptions = {
  // Answers for successive showInputBox calls; each answer also runs through validateInput.
  inputs?: Array<string | undefined>;
  pick?: (items: readonly QuickPickItem[], callIndex: number) => QuickPickItem | undefined;
  // The button the user clicks for a notification; undefined means it was dismissed.
  answer?: (message: RecordedMessage) => string | undefined;
  translate?: (message: string) => string;
  // Keyed by full setting id, for example 'http.proxy'.
  settings?: Record<string, unknown>;
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
};

export function createFakeVscode(options: FakeVscodeOptions = {}): FakeVscode {
  const commandHandlers = new Map<string, () => unknown>();
  const executedCommands: FakeVscode['executedCommands'] = [];
  const messages: RecordedMessage[] = [];
  const settings = new Map(Object.entries(options.settings ?? {}));
  const settingUpdates: FakeVscode['settingUpdates'] = [];
  const statusBarItems: FakeStatusBarItem[] = [];
  const logs: string[] = [];
  const inputs = [...(options.inputs ?? [])];
  let quickPickCalls = 0;

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
      get: (key: string, defaultValue?: unknown) =>
        settings.has(id(key)) ? settings.get(id(key)) : defaultValue,
      update: async (key: string, value: unknown, target?: unknown) => {
        settingUpdates.push({ id: id(key), value, target });
        if (value === undefined) {
          settings.delete(id(key));
        } else {
          settings.set(id(key), value);
        }
      }
    };
    // `get` is overloaded in VS Code's typings; one implementation serves both overloads.
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
        if (value !== undefined) {
          await inputOptions.validateInput?.(value);
        }
        return value;
      },
      showQuickPick: async <T extends QuickPickItem>(items: readonly T[]) =>
        options.pick?.(items, quickPickCalls++) as T | undefined
    },
    workspace: { getConfiguration }
  };
}
