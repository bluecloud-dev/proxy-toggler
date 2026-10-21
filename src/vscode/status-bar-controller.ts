import type * as vscode from 'vscode';

import type { ToggleState } from '../core/proxy-configuration';
import type { StatusBarItem, VscodeApi } from './api';

type StatusBarApi = Pick<VscodeApi, 'StatusBarAlignment' | 'ThemeColor' | 'l10n' | 'window'>;

// What the toggle shows besides the record.
export type StatusView = {
  // The profile name shows in the text only when there are profiles to tell apart.
  profileCount: number;
  drift: boolean;
  settingsHoldProxy: boolean;
};

type Presentation = { icon: string; text: string; tooltip: string; label: string };

// The toggle, and next to it the gear that opens the switcher.
export class StatusBarController implements vscode.Disposable {
  private readonly item: StatusBarItem;
  private readonly gear: StatusBarItem;

  constructor(
    private readonly vscodeApi: StatusBarApi,
    toggleCommandId: string,
    switchCommandId: string
  ) {
    const { l10n, window, StatusBarAlignment } = vscodeApi;
    this.item = window.createStatusBarItem(StatusBarAlignment.Right, 100);
    this.item.command = toggleCommandId;
    this.item.show();

    this.gear = window.createStatusBarItem(StatusBarAlignment.Right, 99);
    this.gear.text = '$(gear)';
    this.gear.tooltip = l10n.t('Switch proxy profile');
    this.gear.accessibilityInformation = { label: l10n.t('Switch proxy profile'), role: 'button' };
    this.gear.command = switchCommandId;
    this.gear.show();
  }

  updateState(state: ToggleState, view: StatusView): void {
    const { l10n, ThemeColor } = this.vscodeApi;
    const presentation = this.presentationFor(state, view);
    // Drift keeps the text, which shows the record, and changes the icon and background: the
    // warning icon shows in every theme, High Contrast Dark included, which has no background.
    const drift = view.drift && state.currentProfile !== undefined;
    const warning = l10n.t('VS Code uses a proxy that matches no profile.');
    const { icon, text, tooltip, label } = drift
      ? {
          ...presentation,
          icon: 'warning',
          tooltip: `${warning} ${presentation.tooltip}`,
          label: `${presentation.label}. ${warning}`
        }
      : presentation;
    this.item.text = `$(${icon}) ${text}`;
    this.item.tooltip = tooltip;
    this.item.accessibilityInformation = { label, role: 'button' };
    this.item.backgroundColor = drift
      ? new ThemeColor('statusBarItem.warningBackground')
      : undefined;
  }

  getText(): string {
    return this.item.text;
  }

  getAccessibilityLabel(): string | undefined {
    return this.item.accessibilityInformation?.label;
  }

  dispose(): void {
    this.item.dispose();
    this.gear.dispose();
  }

  // Literal l10n.t calls, rather than a lookup table, keep these strings extractable.
  private presentationFor(state: ToggleState, view: StatusView): Presentation {
    const { l10n } = this.vscodeApi;
    const current = state.currentProfile;
    const profileCount = view.profileCount;

    // With no profiles there is no drift; a click starts setup from the proxy in use.
    if (!current) {
      return view.settingsHoldProxy
        ? {
            icon: 'warning',
            text: l10n.t('Proxy: Not Configured'),
            tooltip: l10n.t('VS Code already uses a proxy. Click to add a profile from it.'),
            label: l10n.t('Proxy not configured; VS Code already uses a proxy')
          }
        : {
            icon: 'warning',
            text: l10n.t('Proxy: Not Configured'),
            tooltip: l10n.t('No proxy profile yet. Click to add one.'),
            label: l10n.t('Proxy not configured')
          };
    }

    if (state.isEnabled) {
      return {
        icon: 'plug',
        text: profileCount > 1 ? l10n.t('Proxy: {0}', current.name) : l10n.t('Proxy: ON'),
        tooltip: l10n.t('Proxy on: {0}. Click to turn it off.', current.name),
        label: l10n.t('Proxy on, profile {0}', current.name)
      };
    }

    return {
      icon: 'debug-disconnect',
      text: l10n.t('Proxy: OFF'),
      tooltip: l10n.t('Proxy off. Click to turn on {0}.', current.name),
      label: l10n.t('Proxy off, profile {0}', current.name)
    };
  }
}
