import type { ProxyManager } from '../core/proxy-manager';
import type { VscodeApi } from '../vscode/api';
import type { NotificationAction, Notifier } from '../vscode/notification-service';
import { pickProfile } from './pick-profile';
import type { ProxyChange } from './proxy-change';

const ACTION_DELETE: NotificationAction = { id: 'delete', title: 'Delete' };

// Asks which profile, then for confirmation. Deleting the current profile turns the proxy off
// first, and the first remaining profile becomes current.
export async function deleteProfileCommand(
  vscodeApi: Pick<VscodeApi, 'l10n' | 'window'>,
  proxyManager: Pick<ProxyManager, 'getProfiles' | 'getState'>,
  notificationService: Notifier,
  change: ProxyChange
): Promise<void> {
  const profile = await pickProfile(
    vscodeApi,
    proxyManager,
    vscodeApi.l10n.t('Pick a profile to delete')
  );
  if (!profile) {
    return;
  }

  const choice = await notificationService.showWarning(
    `Delete the profile ${profile.name}? If it is on when deleted, the proxy turns off.`,
    ACTION_DELETE
  );
  if (choice !== ACTION_DELETE.id) {
    return;
  }

  await change((manager) => manager.deleteProfile(profile.name));
}
