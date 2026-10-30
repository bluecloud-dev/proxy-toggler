import { findProfileByName, profileSettingValues } from '../core/profiles';
import type { Memento, ProxyManager } from '../core/proxy-manager';
import type { ProxyOutcome } from '../core/proxy-outcome';
import type { HttpSettingKey } from '../core/proxy-settings-writer';
import {
  choiceMadeBy,
  type ChoiceOrigin,
  isInEffect,
  readDefaultProfile,
  type WindowChoice
} from '../core/window-choice';
import type { VscodeApi } from '../vscode/api';
import type { NotificationAction, Notifier } from '../vscode/notification-service';
import type { ProxyChange } from './proxy-change';

export const DEFAULT_PROFILE_SETTING = 'proxyToggler.defaultProfile';

// The profile name this project last asked to add, so that it asks once.
const ASKED_KEY = 'proxyToggler.missingDefaultProfile';

const ACTION_ADD_PROFILE: NotificationAction = { id: 'addProfile', title: 'Add Profile…' };

type ChoiceManager = Pick<
  ProxyManager,
  'getProfiles' | 'getState' | 'hasDrift' | 'settingsHoldProxy'
>;

// This window's choice for VS Code's proxy: what the user last set in this window, or else the
// default profile its settings name. VS Code's proxy follows the focused window's (ADR 0006).
export class WindowChoices {
  // Lasts until the window closes or reloads.
  private override: WindowChoice | undefined;

  constructor(
    private readonly vscodeApi: Pick<VscodeApi, 'l10n' | 'workspace'>,
    private readonly proxyManager: ChoiceManager,
    private readonly notifier: Pick<Notifier, 'showWarning'>,
    private readonly workspaceState: Memento,
    private readonly addProfile: () => Promise<void>
  ) {}

  current(): WindowChoice | undefined {
    // A profile deleted or renamed since the user chose it here: the default takes over.
    if (
      this.override?.kind === 'profile' &&
      !findProfileByName(this.proxyManager.getProfiles(), this.override.name)
    ) {
      this.override = undefined;
    }
    return this.override ?? readDefaultProfile(this.configuration().get('defaultProfile'));
  }

  noteManualChange(outcome: ProxyOutcome | { kind: 'writeFailed' }): void {
    this.override = choiceMadeBy(outcome) ?? this.override;
  }

  // A new default replaces what the user set in this window.
  defaultChanged(): void {
    this.override = undefined;
  }

  // Puts this window's choice into VS Code's proxy settings. Only the focused window calls it.
  async apply(change: ProxyChange): Promise<void> {
    const choice = this.current();
    if (!choice || this.inEffect(choice)) {
      return;
    }
    if (choice.kind === 'off') {
      await change((manager) => manager.disableProxy(), { automatic: true });
    } else if (findProfileByName(this.proxyManager.getProfiles(), choice.name)) {
      await change((manager) => manager.switchTo(choice.name), { automatic: true });
    } else {
      // A teammate's project, or a renamed profile: the proxy stays as it is.
      await this.askToAdd(choice.name);
    }
  }

  // What this window's terminals get: its choice, or else what VS Code uses.
  terminalSettings(
    vscodeSettings: Record<HttpSettingKey, unknown>
  ): Record<HttpSettingKey, unknown> {
    const choice = this.current();
    if (choice?.kind === 'off') {
      return { proxy: undefined, proxyStrictSSL: undefined, noProxy: undefined };
    }
    const profile = choice && findProfileByName(this.proxyManager.getProfiles(), choice.name);
    return profile ? profileSettingValues(profile) : vscodeSettings;
  }

  origin(): ChoiceOrigin | undefined {
    const choice = this.current();
    if (!choice || !this.inEffect(choice)) {
      return undefined;
    }
    if (this.override) {
      return 'window';
    }
    // In Restricted Mode, VS Code reads only the user's value, whatever the folder's says.
    const configuration = this.configuration();
    const projectValue = configuration.inspect('defaultProfile')?.workspaceValue;
    return projectValue !== undefined && projectValue === configuration.get('defaultProfile')
      ? 'project'
      : 'user';
  }

  private inEffect(choice: WindowChoice): boolean {
    return isInEffect(choice, this.proxyManager.getState(), {
      settingsHoldProxy: this.proxyManager.settingsHoldProxy(),
      drift: this.proxyManager.hasDrift()
    });
  }

  private async askToAdd(name: string): Promise<void> {
    if (this.workspaceState.get(ASKED_KEY) === name) {
      return;
    }
    await this.workspaceState.update(ASKED_KEY, name);
    const choice = await this.notifier.showWarning(
      this.vscodeApi.l10n.t("This project uses the proxy profile {0}, which you don't have.", name),
      ACTION_ADD_PROFILE
    );
    if (choice === ACTION_ADD_PROFILE.id) {
      await this.addProfile();
    }
  }

  private configuration() {
    return this.vscodeApi.workspace.getConfiguration('proxyToggler');
  }
}
