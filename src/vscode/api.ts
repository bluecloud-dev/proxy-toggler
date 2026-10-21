import type * as vscode from 'vscode';

import type { SecretStorage } from '../core/keychain-service';
import type { Memento } from '../core/proxy-manager';

// The slice of the VS Code API this extension uses. src/extension.ts passes the real module,
// which must satisfy these signatures without a cast; unit tests pass small fakes.
export type VscodeApi = {
  ConfigurationTarget: { Global: vscode.ConfigurationTarget };
  env: Pick<typeof vscode.env, 'remoteName'>;
  ProgressLocation: { Notification: vscode.ProgressLocation };
  QuickInputButtons: { Back: vscode.QuickInputButton };
  ThemeColor: new (id: string) => vscode.ThemeColor;
  QuickPickItemKind: { Separator: vscode.QuickPickItemKind };
  StatusBarAlignment: { Right: vscode.StatusBarAlignment };
  commands: {
    registerCommand(command: string, callback: (...args: unknown[]) => unknown): vscode.Disposable;
    executeCommand(command: string, ...rest: unknown[]): PromiseLike<unknown>;
  };
  l10n: {
    t(message: string, ...args: Array<string | number | boolean>): string;
  };
  window: {
    createOutputChannel(name: string, options: { log: true }): Logger;
    createInputBox(): InputBox;
    createQuickPick<T extends vscode.QuickPickItem>(): QuickPick<T>;
    createStatusBarItem(alignment: vscode.StatusBarAlignment, priority: number): StatusBarItem;
    showErrorMessage(message: string, ...items: string[]): PromiseLike<string | undefined>;
    showInformationMessage(message: string, ...items: string[]): PromiseLike<string | undefined>;
    showInputBox(options: vscode.InputBoxOptions): PromiseLike<string | undefined>;
    showQuickPick<T extends vscode.QuickPickItem>(
      items: readonly T[],
      options: vscode.QuickPickOptions
    ): PromiseLike<T | undefined>;
    showWarningMessage(message: string, ...items: string[]): PromiseLike<string | undefined>;
    withProgress<R>(options: vscode.ProgressOptions, task: () => PromiseLike<R>): PromiseLike<R>;
    readonly state: Pick<vscode.WindowState, 'focused'>;
    onDidChangeWindowState(listener: (state: vscode.WindowState) => unknown): vscode.Disposable;
  };
  workspace: {
    getConfiguration(section: string): WorkspaceConfiguration;
    onDidChangeConfiguration(
      listener: (event: vscode.ConfigurationChangeEvent) => unknown
    ): vscode.Disposable;
  };
};

export type Logger = Pick<vscode.LogOutputChannel, 'dispose' | 'error'>;

export type StatusBarItem = Pick<
  vscode.StatusBarItem,
  | 'accessibilityInformation'
  | 'backgroundColor'
  | 'command'
  | 'dispose'
  | 'show'
  | 'text'
  | 'tooltip'
>;

export type InputBox = Pick<
  vscode.InputBox,
  | 'buttons'
  | 'dispose'
  | 'hide'
  | 'ignoreFocusOut'
  | 'onDidAccept'
  | 'onDidChangeValue'
  | 'onDidHide'
  | 'onDidTriggerButton'
  | 'placeholder'
  | 'prompt'
  | 'show'
  | 'step'
  | 'title'
  | 'totalSteps'
  | 'validationMessage'
  | 'value'
>;

export type QuickPick<T extends vscode.QuickPickItem> = Pick<
  vscode.QuickPick<T>,
  | 'activeItems'
  | 'dispose'
  | 'hide'
  | 'items'
  | 'matchOnDescription'
  | 'onDidAccept'
  | 'onDidHide'
  | 'placeholder'
  | 'selectedItems'
  | 'show'
  | 'title'
>;

export type WorkspaceConfiguration = Pick<
  vscode.WorkspaceConfiguration,
  'get' | 'inspect' | 'update'
>;

export type ExtensionContext = Pick<vscode.ExtensionContext, 'subscriptions'> & {
  globalState: Memento;
  secrets: SecretStorage;
  globalStorageUri: Pick<vscode.Uri, 'fsPath'>;
};
