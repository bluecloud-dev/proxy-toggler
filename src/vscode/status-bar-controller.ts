import type * as vscode from 'vscode';

import type { ToggleState } from '../core/toggle-state';
import type { StatusBarItem, VscodeApi } from './api';

type StatusBarApi = Pick<VscodeApi, 'StatusBarAlignment' | 'l10n' | 'window'>;

export class StatusBarController implements vscode.Disposable {
  private statusBarItem: StatusBarItem | undefined;

  constructor(
    private readonly vscodeApi: StatusBarApi,
    private readonly toggleCommandId: string
  ) {}

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

  getText(): string | undefined {
    return this.statusBarItem?.text;
  }

  getAccessibilityLabel(): string | undefined {
    return this.statusBarItem?.accessibilityInformation?.label;
  }

  dispose(): void {
    this.statusBarItem?.dispose();
    this.statusBarItem = undefined;
  }
}
