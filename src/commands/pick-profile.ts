import { type Profile, sortByName } from '../core/profiles';
import type { ProxyManager } from '../core/proxy-manager';
import type { VscodeApi } from '../vscode/api';
import { pickOne } from '../vscode/quick-pick';

// Asks which profile, alphabetically, with the current one focused.
export async function pickProfile(
  vscodeApi: Pick<VscodeApi, 'window'>,
  proxyManager: Pick<ProxyManager, 'getProfiles' | 'getState'>,
  placeholder: string
): Promise<Profile | undefined> {
  const current = proxyManager.getState().currentProfile;
  const items = sortByName(proxyManager.getProfiles()).map((profile) => ({
    label: profile.name,
    description: profile.proxyUrl,
    profile
  }));
  const choice = await pickOne(vscodeApi, {
    items,
    activeItem: items.find((item) => item.profile.name === current?.name),
    placeholder
  });
  return choice?.profile;
}
