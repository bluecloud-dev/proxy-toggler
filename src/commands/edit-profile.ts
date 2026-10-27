import type * as vscode from 'vscode';

import { parseNoProxyList } from '../core/no-proxy';
import { findProfileByName, type Profile, sameName, validateProfileName } from '../core/profiles';
import type { ProxyManager } from '../core/proxy-manager';
import {
  problemWith,
  validateBypassPattern,
  validateProxyUrl,
  ValidationError
} from '../core/validation';
import type { VscodeApi } from '../vscode/api';
import type { Notifier } from '../vscode/notification-service';
import { askText } from '../vscode/quick-input';
import { pickOne } from '../vscode/quick-pick';
import { pickProfile } from './pick-profile';
import { showKnownProxyError } from './proxy-feedback';
import { testConnectionCommand } from './test-connection';

type EditApi = Pick<
  VscodeApi,
  'ProgressLocation' | 'QuickInputButtons' | 'commands' | 'env' | 'l10n' | 'window' | 'workspace'
>;

type EditManager = Pick<
  ProxyManager,
  'getEntryNames' | 'getProfiles' | 'getState' | 'updateProfile'
>;

type Field = 'name' | 'proxyUrl' | 'strictSSL' | 'bypassList' | 'test';

// Lists the fields of a profile; each pick edits one field and saves it, until Escape. Without a
// name, it first asks which profile.
export async function editProfileCommand(
  vscodeApi: EditApi,
  proxyManager: EditManager,
  notificationService: Notifier,
  refreshUi: () => Promise<void>,
  profileName?: string
): Promise<void> {
  let name =
    profileName ??
    (await pickProfile(vscodeApi, proxyManager, vscodeApi.l10n.t('Pick a profile to edit')))?.name;

  while (name !== undefined) {
    const profile = findProfileByName(proxyManager.getProfiles(), name);
    if (!profile) {
      return;
    }

    const state = proxyManager.getState();
    const applies = state.isEnabled && sameName(state.currentProfile?.name ?? '', profile.name);
    const field = await pickField(vscodeApi, profile, applies);
    if (!field) {
      return;
    }
    if (field === 'test') {
      await testConnectionCommand(vscodeApi, notificationService, profile);
      continue;
    }

    const edited = await editField(vscodeApi, profile, field, otherNames(proxyManager, profile));
    if (!edited) {
      continue;
    }

    try {
      await proxyManager.updateProfile(profile.name, edited);
    } catch (error: unknown) {
      // The list changed under the edit, in another window or through Settings Sync.
      if (error instanceof ValidationError) {
        notificationService.inform('error', error.reason);
        return;
      }
      await refreshUi();
      await showKnownProxyError(vscodeApi, notificationService, error, { offerDisable: true });
    }
    await refreshUi();
    if (edited.name !== profile.name) {
      notificationService.inform(
        'warning',
        `Renamed ${profile.name} to ${edited.name}. Keybindings that switch to "${profile.name}" by name stop working.`
      );
    }
    name = edited.name;
  }
}

async function pickField(
  vscodeApi: EditApi,
  profile: Profile,
  applies: boolean
): Promise<Field | undefined> {
  const { l10n } = vscodeApi;
  const items: Array<vscode.QuickPickItem & { field: Field }> = [
    { label: l10n.t('Name'), description: profile.name, field: 'name' },
    { label: l10n.t('Proxy URL'), description: profile.proxyUrl, field: 'proxyUrl' },
    {
      label: l10n.t('Strict SSL'),
      description: profile.strictSSL ? l10n.t('On') : l10n.t('Off'),
      field: 'strictSSL'
    },
    {
      label: l10n.t('Bypass list'),
      description: profile.bypassList.join(', ') || l10n.t('(empty)'),
      field: 'bypassList'
    },
    { label: l10n.t('Test Connection…'), field: 'test' }
  ];
  const choice = await pickOne(vscodeApi, {
    title: l10n.t('Edit {0}', profile.name),
    items,
    placeholder: applies
      ? l10n.t('Changes save and apply immediately; Escape when done')
      : l10n.t('Changes save immediately; Escape when done')
  });
  return choice?.field;
}

// The profile with one field changed, or undefined when the user cancels.
async function editField(
  vscodeApi: EditApi,
  profile: Profile,
  field: Exclude<Field, 'test'>,
  takenNames: readonly string[]
): Promise<Profile | undefined> {
  const { l10n } = vscodeApi;
  const ask = (prompt: string, value: string, validate: (value: string) => string | undefined) =>
    askText(vscodeApi, {
      title: l10n.t('Edit {0}', profile.name),
      prompt,
      value,
      canGoBack: false,
      validate
    });

  switch (field) {
    case 'name': {
      const name = await ask(l10n.t('A name for the profile'), profile.name, (value) =>
        validateProfileName(value, takenNames)
      );
      return typeof name === 'string' ? { ...profile, name: name.trim() } : undefined;
    }
    case 'proxyUrl': {
      const proxyUrl = await ask(
        l10n.t('The proxy URL, such as http://proxy.example.com:8080'),
        profile.proxyUrl,
        (value) => problemWith(() => validateProxyUrl(value))
      );
      return typeof proxyUrl === 'string' ? { ...profile, proxyUrl: proxyUrl.trim() } : undefined;
    }
    case 'strictSSL': {
      const items = [
        { label: l10n.t('On'), strictSSL: true },
        { label: l10n.t('Off'), strictSSL: false }
      ];
      // Only says what honors the setting, and never suggests turning it off.
      const choice = await pickOne(vscodeApi, {
        title: l10n.t('Strict SSL for {0}', profile.name),
        items,
        activeItem: items.find((item) => item.strictSSL === profile.strictSSL),
        placeholder: l10n.t("Only VS Code's command line and some built-in extensions honor it")
      });
      return choice ? { ...profile, strictSSL: choice.strictSSL } : undefined;
    }
    case 'bypassList': {
      const patterns = await ask(
        l10n.t(
          'Hosts that VS Code reaches directly, separated by commas, such as .example.com. Only exact host names and domains that start with a dot work for all of VS Code. Loopback addresses always go direct, and any entry makes VS Code ignore NO_PROXY.'
        ),
        profile.bypassList.join(', '),
        (value) => validatePatterns(value)
      );
      return typeof patterns === 'string'
        ? { ...profile, bypassList: parseNoProxyList(patterns) }
        : undefined;
    }
  }
}

function otherNames(proxyManager: EditManager, profile: Profile): string[] {
  return proxyManager.getEntryNames().filter((name) => !sameName(name, profile.name));
}

function validatePatterns(value: string): string | undefined {
  for (const pattern of parseNoProxyList(value)) {
    const problem = problemWith(() => validateBypassPattern(pattern));
    if (problem) {
      return problem;
    }
  }
  return undefined;
}
