import type * as vscode from 'vscode';

import type { ToggleState } from '../types/toggle-state';

type L10n = {
  t: (message: string, ...args: (string | number)[]) => string;
};

type StatusBarItem = {
  text: string;
  tooltip?: string | vscode.MarkdownString;
  command?: string | vscode.Command;
  accessibilityInformation?: vscode.AccessibilityInformation;
  show: () => void;
  dispose: () => void;
};

type WindowApi = {
  createStatusBarItem: (alignment: vscode.StatusBarAlignment, priority?: number) => StatusBarItem;
};

type VscodeApi = {
  StatusBarAlignment: { Right: vscode.StatusBarAlignment };
  l10n: L10n;
  window: WindowApi;
};

export class StatusBarController implements vscode.Disposable {
  private statusBarItem: StatusBarItem | undefined;

  /**
   * @param vscodeApi VS Code API surface for status bar and localization.
   * @param toggleCommandId Command invoked when the status bar item is clicked.
   * @example
   * ```ts
   * const controller = new StatusBarController(vscode, 'proxyToggler.toggle');
   * controller.initialize();
   * ```
   */
  constructor(
    private readonly vscodeApi: VscodeApi,
    private readonly toggleCommandId: string
  ) {}

  /**
   * Creates and shows the status bar item (idempotent).
   *
   * @returns void
   * @throws {Error} If VS Code fails to create the status bar item.
   * @example
   * ```ts
   * controller.initialize();
   * ```
   */
  initialize(): void {
    if (this.statusBarItem) {
      return;
    }

    const item = this.vscodeApi.window.createStatusBarItem(
      this.vscodeApi.StatusBarAlignment.Right,
      100
    );
    item.command = this.toggleCommandId;
    item.show();

    this.statusBarItem = item;
  }

  /**
   * Updates the status bar text, tooltip, and accessibility label.
   *
   * @param state Current toggle state.
   * @returns void
   * @example
   * ```ts
   * controller.updateState({ hasConfiguration: true, isEnabled: false });
   * ```
   */
  updateState(state: ToggleState): void {
    if (!this.statusBarItem) {
      return;
    }

    if (!state.hasConfiguration) {
      this.statusBarItem.text = `$(warning) ${this.vscodeApi.l10n.t('Proxy: Not Configured')}`;
      this.statusBarItem.tooltip = this.vscodeApi.l10n.t(
        'Configure proxy settings to enable toggling.'
      );
      this.statusBarItem.accessibilityInformation = {
        label: this.vscodeApi.l10n.t('Proxy status: not configured'),
        role: 'button'
      };
      this.statusBarItem.show();
      return;
    }

    if (state.isEnabled) {
      this.statusBarItem.text = `$(plug) ${this.vscodeApi.l10n.t('Proxy: ON')}`;
      this.statusBarItem.tooltip = this.vscodeApi.l10n.t('Proxy is enabled. Click to toggle.');
      this.statusBarItem.accessibilityInformation = {
        label: this.vscodeApi.l10n.t('Proxy status: enabled'),
        role: 'button'
      };
      this.statusBarItem.show();
      return;
    }

    this.statusBarItem.text = `$(debug-disconnect) ${this.vscodeApi.l10n.t('Proxy: OFF')}`;
    this.statusBarItem.tooltip = this.vscodeApi.l10n.t('Proxy is disabled. Click to toggle.');
    this.statusBarItem.accessibilityInformation = {
      label: this.vscodeApi.l10n.t('Proxy status: disabled'),
      role: 'button'
    };
    this.statusBarItem.show();
  }

  /**
   * @returns Current status bar text, if initialized.
   * @example
   * ```ts
   * const text = controller.getText();
   * ```
   */
  getText(): string | undefined {
    return this.statusBarItem?.text;
  }

  /**
   * @returns Current accessibility label, if initialized.
   * @example
   * ```ts
   * const label = controller.getAccessibilityLabel();
   * ```
   */
  getAccessibilityLabel(): string | undefined {
    return this.statusBarItem?.accessibilityInformation?.label;
  }

  /**
   * Disposes the status bar item.
   *
   * @returns void
   * @example
   * ```ts
   * controller.dispose();
   * ```
   */
  dispose(): void {
    this.statusBarItem?.dispose();
    this.statusBarItem = undefined;
  }
}
