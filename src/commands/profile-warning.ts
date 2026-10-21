import { createHash } from 'node:crypto';

import type { FlaggedEntry } from '../core/profiles';
import type { Memento } from '../core/proxy-manager';
import type { VscodeApi } from '../vscode/api';
import type { NotificationAction, Notifier } from '../vscode/notification-service';

// A hash of the hidden entries last warned about, per VS Code Profile. A hash, because a hidden
// entry may hold anything, credentials included, and none of it may reach globalState.
const WARNED_KEY = 'proxyToggler.hiddenProfilesWarned';

const ACTION_OPEN_SETTINGS: NotificationAction = { id: 'openSettings', title: 'Open Settings' };

// Warns once per distinct set of hidden entries. Only the Default profile's settings file holds
// proxyToggler.profiles, so Open Settings opens the application settings file.
export async function warnAboutHiddenProfiles(
  vscodeApi: Pick<VscodeApi, 'commands'>,
  globalState: Memento,
  notificationService: Pick<Notifier, 'showWarning'>,
  hidden: readonly FlaggedEntry[]
): Promise<void> {
  const fingerprint = hidden.length === 0 ? undefined : hashOf(hidden.map(({ entry }) => entry));
  if (globalState.get<string>(WARNED_KEY) === fingerprint) {
    return;
  }

  await globalState.update(WARNED_KEY, fingerprint);
  if (fingerprint === undefined) {
    return;
  }

  const choice = await notificationService.showWarning(warningFor(hidden), ACTION_OPEN_SETTINGS);
  if (choice === ACTION_OPEN_SETTINGS.id) {
    await vscodeApi.commands.executeCommand('workbench.action.openApplicationSettingsJson');
  }
}

function warningFor(hidden: readonly FlaggedEntry[]): string {
  const count = hidden.length === 1 ? 'an entry' : `${hidden.length} entries`;
  const details = hidden.map(({ label, reason }) => `${label} ${reason}`).join('; ');
  return `Proxy Toggler ignores ${count} in proxyToggler.profiles: ${details}.`;
}

function hashOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
