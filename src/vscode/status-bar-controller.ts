import type * as vscode from 'vscode';

import type { ToggleState } from '../core/proxy-configuration';
import type { StatusBarItem, VscodeApi } from './api';

type StatusBarApi = Pick<VscodeApi, 'StatusBarAlignment' | 'l10n' | 'window'>;

type Presentation = { icon: string; text: string; tooltip: string; label: string };

export class StatusBarController implements vscode.Disposable {
  private readonly item: StatusBarItem;

  constructor(
    private readonly vscodeApi: StatusBarApi,
    toggleCommandId: string
  ) {
    this.item = vscodeApi.window.createStatusBarItem(vscodeApi.StatusBarAlignment.Right, 100);
    this.item.command = toggleCommandId;
    this.item.show();
  }

  updateState(state: ToggleState): void {
    const { icon, text, tooltip, label } = this.presentationFor(state);
    this.item.text = `$(${icon}) ${text}`;
    this.item.tooltip = tooltip;
    this.item.accessibilityInformation = { label, role: 'button' };
  }

  getText(): string {
    return this.item.text;
  }

  getAccessibilityLabel(): string | undefined {
    return this.item.accessibilityInformation?.label;
  }

  dispose(): void {
    this.item.dispose();
  }

  // Literal l10n.t calls, rather than a lookup table, keep these strings extractable.
  private presentationFor(state: ToggleState): Presentation {
    const { l10n } = this.vscodeApi;

    if (!state.hasConfiguration) {
      return {
        icon: 'warning',
        text: l10n.t('Proxy: Not Configured'),
        tooltip: l10n.t('Configure proxy settings to enable toggling.'),
        label: l10n.t('Proxy status: not configured')
      };
    }

    if (state.isEnabled) {
      return {
        icon: 'plug',
        text: l10n.t('Proxy: ON'),
        tooltip: l10n.t('Proxy is enabled. Click to toggle.'),
        label: l10n.t('Proxy status: enabled')
      };
    }

    return {
      icon: 'debug-disconnect',
      text: l10n.t('Proxy: OFF'),
      tooltip: l10n.t('Proxy is disabled. Click to toggle.'),
      label: l10n.t('Proxy status: disabled')
    };
  }
}
