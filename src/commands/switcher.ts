import type * as vscode from 'vscode';

import { type Profile, sortByName } from '../core/profiles';
import type { ProxyManager } from '../core/proxy-manager';
import type { VscodeApi } from '../vscode/api';
import type { Notifier } from '../vscode/notification-service';
import { pickOne } from '../vscode/quick-pick';
import { addProfileCommand } from './add-profile';
import { EXTENSION_ID } from './command-ids';
import { deleteProfileCommand } from './delete-profile';
import { editProfileCommand } from './edit-profile';
import { announceSwitch, showKnownProxyError } from './proxy-feedback';

type SwitcherApi = Pick<
  VscodeApi,
  'QuickInputButtons' | 'QuickPickItemKind' | 'commands' | 'l10n' | 'window' | 'workspace'
>;

type SwitcherManager = Pick<
  ProxyManager,
  | 'addProfile'
  | 'deleteProfile'
  | 'disableProxy'
  | 'enableProxy'
  | 'getEntryNames'
  | 'getProfiles'
  | 'getState'
  | 'hasConfiguration'
  | 'readProxySettings'
  | 'switchTo'
  | 'updateProfile'
>;

type SwitcherItem = vscode.QuickPickItem & {
  profile?: Profile;
  action?: 'toggle' | 'add' | 'edit' | 'delete' | 'settings';
};

// Opens the switcher, or switches straight to the profile a keybinding names.
export async function switchProfileCommand(
  vscodeApi: SwitcherApi,
  proxyManager: SwitcherManager,
  notificationService: Notifier,
  refreshUi: () => Promise<void>,
  name?: unknown
): Promise<void> {
  if (typeof name === 'string') {
    if (await turnOn(vscodeApi, proxyManager, notificationService, refreshUi, name)) {
      return;
    }
    void notificationService.showError(`No proxy profile is named "${name}".`);
  }

  await showSwitcher(vscodeApi, proxyManager, notificationService, refreshUi);
}

async function showSwitcher(
  vscodeApi: SwitcherApi,
  proxyManager: SwitcherManager,
  notificationService: Notifier,
  refreshUi: () => Promise<void>
): Promise<void> {
  const { l10n } = vscodeApi;
  const { isEnabled, currentProfile } = proxyManager.getState();
  const isCurrent = (profile: Profile): boolean => profile.name === currentProfile?.name;

  const profileItems: SwitcherItem[] = sortByName(proxyManager.getProfiles()).map((profile) => ({
    label: isCurrent(profile) ? `$(check) ${profile.name}` : profile.name,
    description: profile.proxyUrl,
    profile
  }));
  const actionItems: SwitcherItem[] = [
    ...(currentProfile
      ? [
          {
            label: l10n.t(isEnabled ? 'Turn Proxy Off' : 'Turn Proxy On'),
            action: 'toggle' as const
          }
        ]
      : []),
    { label: l10n.t('Add Profile…'), action: 'add' },
    ...(profileItems.length > 0
      ? [
          { label: l10n.t('Edit Profile…'), action: 'edit' as const },
          { label: l10n.t('Delete Profile…'), action: 'delete' as const }
        ]
      : []),
    { label: l10n.t('Extension Settings'), action: 'settings' }
  ];
  const separator: SwitcherItem[] =
    profileItems.length > 0 ? [{ label: '', kind: vscodeApi.QuickPickItemKind.Separator }] : [];

  // Opens on the current profile, so Enter keeps it, or turns it on while the proxy is off.
  const choice = await pickOne(vscodeApi, {
    items: [...profileItems, ...separator, ...actionItems],
    activeItem: profileItems.find((item) => item.profile && isCurrent(item.profile)),
    placeholder: l10n.t('Pick a proxy profile to turn on')
  });

  if (choice?.profile) {
    if (!(isEnabled && isCurrent(choice.profile))) {
      await turnOn(vscodeApi, proxyManager, notificationService, refreshUi, choice.profile.name);
    }
  } else if (choice?.action === 'toggle') {
    await turnOnOrOff(vscodeApi, proxyManager, notificationService, refreshUi, !isEnabled);
  } else if (choice?.action === 'add') {
    await addProfileCommand(vscodeApi, proxyManager, notificationService, refreshUi);
  } else if (choice?.action === 'edit') {
    await editProfileCommand(vscodeApi, proxyManager, notificationService, refreshUi);
  } else if (choice?.action === 'delete') {
    await deleteProfileCommand(vscodeApi, proxyManager, notificationService, refreshUi);
  } else if (choice?.action === 'settings') {
    await vscodeApi.commands.executeCommand(
      'workbench.action.openSettings',
      `@ext:${EXTENSION_ID}`
    );
  }
}

// False when no profile has the name.
async function turnOn(
  vscodeApi: SwitcherApi,
  proxyManager: SwitcherManager,
  notificationService: Notifier,
  refreshUi: () => Promise<void>,
  name: string
): Promise<boolean> {
  try {
    const profile = await proxyManager.switchTo(name);
    if (!profile) {
      return false;
    }
    await refreshUi();
    await announceSwitch(
      vscodeApi,
      notificationService,
      `Proxy Toggler turned on ${profile.name}.`
    );
  } catch (error: unknown) {
    await showKnownProxyError(vscodeApi, notificationService, error, { offerDisable: true });
  }
  return true;
}

async function turnOnOrOff(
  vscodeApi: SwitcherApi,
  proxyManager: SwitcherManager,
  notificationService: Notifier,
  refreshUi: () => Promise<void>,
  on: boolean
): Promise<void> {
  try {
    await (on ? proxyManager.enableProxy() : proxyManager.disableProxy());
    await refreshUi();
    const name = proxyManager.getState().currentProfile?.name ?? '';
    await announceSwitch(
      vscodeApi,
      notificationService,
      on ? `Proxy Toggler turned on ${name}.` : `Proxy Toggler turned off ${name}.`
    );
  } catch (error: unknown) {
    await showKnownProxyError(vscodeApi, notificationService, error, { offerDisable: on });
  }
}
