import type * as vscode from 'vscode';

import type { SecretStorage } from '../core/keychain-service';
import type { Memento } from '../core/proxy-manager';

// The slice of the VS Code API this extension uses. src/extension.ts passes the real module,
// which must satisfy these signatures without a cast; unit tests pass small fakes.
export type VscodeApi = {
  ConfigurationTarget: { Global: vscode.ConfigurationTarget };
  StatusBarAlignment: { Right: vscode.StatusBarAlignment };
  commands: {
    registerCommand(command: string, callback: () => unknown): vscode.Disposable;
    executeCommand(command: string, ...rest: unknown[]): PromiseLike<unknown>;
  };
  l10n: {
    t(message: string, ...args: Array<string | number | boolean>): string;
  };
  window: {
    createStatusBarItem(alignment: vscode.StatusBarAlignment, priority: number): StatusBarItem;
    showErrorMessage(message: string, ...items: string[]): PromiseLike<string | undefined>;
    showInformationMessage(message: string, ...items: string[]): PromiseLike<string | undefined>;
    showInputBox(options: vscode.InputBoxOptions): PromiseLike<string | undefined>;
    showQuickPick<T extends vscode.QuickPickItem>(
      items: readonly T[],
      options: vscode.QuickPickOptions
    ): PromiseLike<T | undefined>;
    showWarningMessage(message: string, ...items: string[]): PromiseLike<string | undefined>;
  };
  workspace: {
    getConfiguration(section: string): WorkspaceConfiguration;
  };
};

export type StatusBarItem = Pick<
  vscode.StatusBarItem,
  'accessibilityInformation' | 'command' | 'dispose' | 'show' | 'text' | 'tooltip'
>;

export type WorkspaceConfiguration = Pick<
  vscode.WorkspaceConfiguration,
  'get' | 'inspect' | 'update'
>;

export type ExtensionContext = Pick<vscode.ExtensionContext, 'subscriptions'> & {
  globalState: Memento;
  secrets: SecretStorage;
};
