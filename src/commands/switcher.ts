import type * as vscode from 'vscode';

import { type Profile, sortByName } from '../core/profiles';
import type { ProxyManager } from '../core/proxy-manager';
import type { VscodeApi } from '../vscode/api';
import { useLocalProxySettings, useOwnProxySettings } from '../vscode/http-settings';
import type { Notifier } from '../vscode/notification-service';
import { pickOne } from '../vscode/quick-pick';
import { addProfileCommand } from './add-profile';
import { EXTENSION_ID } from './command-ids';
import { deleteProfileCommand } from './delete-profile';
import { editProfileCommand } from './edit-profile';
import { type ProxyChange, turnOnOrOff } from './proxy-change';
import { remoteProxyChoice } from './remote-proxy';

type SwitcherApi = Pick<
  VscodeApi,
  | 'ConfigurationTarget'
  | 'ProgressLocation'
  | 'QuickInputButtons'
  | 'QuickPickItemKind'
  | 'commands'
  | 'env'
  | 'l10n'
  | 'window'
  | 'workspace'
>;

type SwitcherManager = Pick<
  ProxyManager,
  | 'getEntryNames'
  | 'getProfiles'
  | 'getState'
  | 'hasConfiguration'
  | 'hasDrift'
  | 'readProxySettings'
  | 'settingsHoldProxy'
>;

type SwitcherItem = vscode.QuickPickItem & {
  profile?: Profile;
  action?: 'on' | 'off' | 'save' | 'add' | 'edit' | 'delete' | 'separate' | 'shared' | 'settings';
};

// Opens the switcher, or switches straight to the profile a keybinding names.
export async function switchProfileCommand(
  vscodeApi: SwitcherApi,
  proxyManager: SwitcherManager,
  notificationService: Notifier,
  change: ProxyChange,
  name?: unknown
): Promise<void> {
  if (typeof name === 'string') {
    const result = await change((manager) => manager.switchTo(name));
    // Only a missing profile falls through to the switcher; the change has already said so.
    if (result.kind !== 'gone') {
      return;
    }
  }

  await showSwitcher(vscodeApi, proxyManager, notificationService, change);
}

async function showSwitcher(
  vscodeApi: SwitcherApi,
  proxyManager: SwitcherManager,
  notificationService: Notifier,
  change: ProxyChange
): Promise<void> {
  const { l10n } = vscodeApi;
  const { isEnabled, currentProfile } = proxyManager.getState();
  const isCurrent = (profile: Profile): boolean => profile.name === currentProfile?.name;

  const profileItems: SwitcherItem[] = sortByName(proxyManager.getProfiles()).map((profile) => ({
    label: isCurrent(profile) ? `$(check) ${profile.name}` : profile.name,
    description:
      isCurrent(profile) && !isEnabled
        ? l10n.t('{0} — current, proxy off', profile.proxyUrl)
        : profile.proxyUrl,
    profile
  }));
  // While drift lasts: save what VS Code uses, or put the record back into the settings.
  const driftItems: SwitcherItem[] =
    proxyManager.hasDrift() && currentProfile
      ? [
          { label: l10n.t('Save Current Settings as Profile…'), action: 'save' },
          isEnabled
            ? { label: l10n.t('Re-apply {0}', currentProfile.name), action: 'on' }
            : { label: l10n.t('Turn Proxy Off'), action: 'off' }
        ]
      : [];
  const toggleItem: SwitcherItem = {
    label: l10n.t(isEnabled ? 'Turn Proxy Off' : 'Turn Proxy On'),
    action: isEnabled ? 'off' : 'on'
  };
  // Whose proxy settings the remote side uses: first while the current profile cannot work there.
  const remote = remoteProxyChoice(vscodeApi, currentProfile);
  const remoteItem: SwitcherItem[] = remote
    ? [{ label: remote.label, detail: remote.detail, action: remote.action }]
    : [];
  const actionItems: SwitcherItem[] = [
    ...driftItems,
    ...(currentProfile ? [toggleItem] : []),
    { label: l10n.t('Add Profile…'), action: 'add' },
    ...(profileItems.length > 0
      ? [
          { label: l10n.t('Edit Profile…'), action: 'edit' as const },
          { label: l10n.t('Delete Profile…'), action: 'delete' as const }
        ]
      : []),
    ...(remote?.first ? [] : remoteItem),
    { label: l10n.t('Extension Settings'), action: 'settings' }
  ];
  const separator: SwitcherItem[] =
    profileItems.length > 0 ? [{ label: '', kind: vscodeApi.QuickPickItemKind.Separator }] : [];
  const leading = remote?.first ? [...remoteItem, ...separator] : [];

  // Opens on the current profile, so Enter keeps it, or turns it on while the proxy is off.
  const choice = await pickOne(vscodeApi, {
    items: [...leading, ...profileItems, ...separator, ...actionItems],
    activeItem: profileItems.find((item) => item.profile && isCurrent(item.profile)),
    placeholder: l10n.t('Pick a proxy profile to turn on')
  });

  if (choice?.profile) {
    if (!(isEnabled && isCurrent(choice.profile))) {
      const { name } = choice.profile;
      await change((manager) => manager.switchTo(name));
    }
  } else if (choice?.action === 'on' || choice?.action === 'off') {
    await turnOnOrOff(change, choice.action === 'on');
  } else if (choice?.action === 'save') {
    await addProfileCommand(vscodeApi, proxyManager, notificationService, change, {
      fromCurrentSettings: true
    });
  } else if (choice?.action === 'add') {
    await addProfileCommand(vscodeApi, proxyManager, notificationService, change);
  } else if (choice?.action === 'edit') {
    await editProfileCommand(vscodeApi, proxyManager, notificationService, change);
  } else if (choice?.action === 'delete') {
    await deleteProfileCommand(vscodeApi, proxyManager, notificationService, change);
  } else if (choice?.action === 'separate') {
    await useOwnProxySettings(vscodeApi);
  } else if (choice?.action === 'shared') {
    await useLocalProxySettings(vscodeApi);
  } else if (choice?.action === 'settings') {
    await vscodeApi.commands.executeCommand(
      'workbench.action.openSettings',
      `@ext:${EXTENSION_ID}`
    );
  }
}
