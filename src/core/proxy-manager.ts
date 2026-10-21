import type * as vscode from 'vscode';

import { hasCredentials, settingsMatch } from './match';
import { parseNoProxyList } from './no-proxy';
import {
  checkProfiles,
  defaultProfileName,
  entryNames,
  findCurrentProfile,
  findProfileByName,
  type FlaggedEntry,
  type Profile,
  profileSettingValues,
  type ProfilesSetting,
  readProfiles,
  sameName,
  sameValues,
  sortByName,
  validateProfileName,
  withoutProfile,
  withProfile
} from './profiles';
import type { ToggleState } from './proxy-configuration';
import {
  type HttpSettingKey,
  type HttpSettings,
  ProxySettingsWriter
} from './proxy-settings-writer';
import {
  problemWith,
  validateBypassPattern,
  validateProxyUrl,
  ValidationError
} from './validation';

const STORAGE_KEYS = {
  // 0.1.x's configuration, which v0.2.0 reads and never writes or deletes (ADR 0001).
  savedProxy: 'proxyToggler.savedProxy',
  // The savedProxy values whose copy a later read showed; per VS Code Profile, like savedProxy.
  migratedProxy: 'proxyToggler.migratedProxy',
  toggleState: 'proxyToggler.state'
} as const;

export type Memento = Pick<vscode.Memento, 'get' | 'update'>;

// The record of the proxy settings a window manages (GLOSSARY.md): per VS Code Profile for this
// computer's settings, per machine for a remote machine's own (ADR 0005). 0.1.x wrote
// isEnabled and hasConfiguration and keeps fields it does not know, such as currentProfile, which
// remembers the current profile by name and values.
type StoredRecord = {
  isEnabled?: boolean;
  hasConfiguration?: boolean;
  currentProfile?: Profile;
};

// What the UI says while ProxyManager changes the settings.
export type ProxyNotices = {
  // Before Proxy Toggler overwrites or clears an http.proxy that holds credentials.
  credentialsWillBeRemoved(): Promise<void>;
};

// Profiles hold no credentials, and none reach settings or globalState (ADR 0003).
export class ProxyManager {
  // Settles once the most recent state change has settled; see serialize().
  private lastChange: Promise<unknown> = Promise.resolve();
  // Writes of settings this ProxyManager has under way; see isMakingOwnChange().
  private ownWrites = 0;
  private readonly settingsWriter: ProxySettingsWriter;

  constructor(
    private readonly globalState: Memento,
    private readonly httpSettings: HttpSettings,
    private readonly profilesSetting: ProfilesSetting,
    private readonly notices: ProxyNotices = { credentialsWillBeRemoved: () => Promise.resolve() },
    // Where the record of the settings this window manages lives (ADR 0005).
    private readonly records: Memento = globalState
  ) {
    this.settingsWriter = new ProxySettingsWriter(httpSettings);
  }

  // Adds a profile at the end of the list, keeping every other entry. 'on' means it matched VS
  // Code's settings while no profile did, so it became current and on; otherwise it becomes
  // current only while no profile is remembered.
  addProfile(profile: Profile): Promise<'on' | 'saved'> {
    return this.serialize(async () => {
      const entries = this.profileEntries();
      const nameProblem = validateProfileName(profile.name, entryNames(entries));
      if (nameProblem) {
        throw new ValidationError('name', nameProblem);
      }
      validateProxyUrl(profile.proxyUrl);

      const settings = this.httpSettings.read();
      const matchedBefore = this.getProfiles().some((existing) =>
        settingsMatch(settings, profileSettingValues(existing))
      );
      const added: Profile = { ...profile, name: profile.name.trim() };
      await this.writing(() => this.profilesSetting.write([...entries, added]));

      if (!matchedBefore && settingsMatch(settings, profileSettingValues(added))) {
        await this.writeState({ isEnabled: true, currentProfile: added });
        return 'on';
      }
      if (!this.storedRecord()?.currentProfile) {
        await this.writeState({ currentProfile: added });
      }
      return 'saved';
    });
  }

  // Saves an edited profile over its entry. Saving the current profile keeps it current, under
  // its new name if it has one, and re-applies it while the proxy is on.
  updateProfile(originalName: string, profile: Profile): Promise<void> {
    return this.serialize(async () => {
      const entries = this.profileEntries();
      // The profile keeps its own name even when a hidden later entry holds it too: the first
      // entry with a name owns it.
      const nameProblem = validateProfileName(
        profile.name,
        entryNames(entries).filter((name) => !sameName(name, originalName))
      );
      if (nameProblem) {
        throw new ValidationError('name', nameProblem);
      }
      validateProxyUrl(profile.proxyUrl);
      for (const pattern of profile.bypassList) {
        validateBypassPattern(pattern);
      }

      const { isEnabled, currentProfile } = this.getState();
      const isCurrent = currentProfile !== undefined && sameName(currentProfile.name, originalName);
      const saved: Profile = {
        ...profile,
        name: profile.name.trim(),
        proxyUrl: profile.proxyUrl.trim()
      };
      await this.writing(() =>
        this.profilesSetting.write(withProfile(entries, saved, originalName))
      );
      if (isCurrent) {
        if (isEnabled) {
          await this.applySettings(saved);
        }
        await this.writeState({ currentProfile: saved });
      }
    });
  }

  // Deletes a profile. Deleting the current profile turns the proxy off first, and the first
  // remaining profile becomes current; deleting the last one leaves nothing configured.
  deleteProfile(name: string): Promise<void> {
    return this.serialize(async () => {
      const { isEnabled, currentProfile } = this.getState();
      const isCurrent = currentProfile !== undefined && sameName(currentProfile.name, name);
      if (isCurrent && isEnabled) {
        await this.disable();
      }

      await this.writing(() =>
        this.profilesSetting.write(withoutProfile(this.profileEntries(), name))
      );
      if (isCurrent) {
        const first = sortByName(this.getProfiles())[0];
        await this.writeState({ isEnabled: false, currentProfile: first });
      }
    });
  }

  // The values of VS Code's proxy settings, defaults included.
  readProxySettings(): Record<HttpSettingKey, unknown> {
    return this.httpSettings.read();
  }

  // Copies the 0.1.x configuration of this VS Code Profile into a profile (ADR 0001).
  migrateSavedProxy(): Promise<void> {
    return this.serialize(async () => {
      const values = savedProxyValues(this.globalState.get(STORAGE_KEYS.savedProxy));
      if (!values || this.alreadyMigrated(values)) {
        return;
      }

      const entries = this.profileEntries();
      const migrated: Profile = {
        name: defaultProfileName(hostOf(values.proxyUrl), entryNames(entries)),
        ...values
      };
      const existing = readProfiles(entries).find((profile) => sameValues(profile, migrated));
      const profile = existing ?? migrated;
      if (existing) {
        // A read shows the copy, so a concurrent write from another VS Code Profile did not lose
        // it. Only now is the marker written; until then every activation retries.
        await this.globalState.update(STORAGE_KEYS.migratedProxy, values);
      } else {
        await this.writing(() => this.profilesSetting.write([...entries, profile]));
      }
      // A VS Code Profile without a current profile starts with the one it used in 0.1.x.
      if (!this.storedRecord()?.currentProfile) {
        await this.writeState({ currentProfile: profile });
      }
    });
  }

  enableProxy(): Promise<void> {
    return this.serialize(() => this.enable());
  }

  disableProxy(): Promise<void> {
    return this.serialize(() => this.disable());
  }

  toggleProxy(): Promise<boolean> {
    return this.serialize(async () => {
      if (!this.hasConfiguration()) {
        throw new Error('No proxy configuration found');
      }

      if (this.getState().isEnabled) {
        await this.disable();
        return false;
      }

      await this.enable();
      return true;
    });
  }

  // Makes the named profile current and turns it on. Undefined when no profile the switcher
  // shows has that name.
  switchTo(name: string): Promise<Profile | undefined> {
    return this.serialize(async () => {
      const profile = findProfileByName(this.getProfiles(), name);
      if (profile) {
        await this.applySettings(profile);
        await this.writeState({ isEnabled: true, currentProfile: profile });
      }
      return profile;
    });
  }

  // True while this ProxyManager writes settings, so that a change event can be told apart from
  // an outside change.
  isMakingOwnChange(): boolean {
    return this.ownWrites > 0;
  }

  // Brings the record in step with VS Code's settings. Settings cleared: off. Settings that match a
  // profile: that profile current and on, the current profile winning a tie. Anything else is
  // drift, which leaves the record alone. Only the focused window re-applies an outside edit to
  // the remembered current profile, and only while on and while the settings still hold its old
  // values; a profile that is current only through the fallback is never re-applied.
  reconcile(options: { focused: boolean }): Promise<void> {
    return this.serialize(async () => {
      const stored = this.storedRecord();
      const remembered = stored?.currentProfile;
      const profiles = this.getProfiles();
      const settings = this.httpSettings.read();

      if (options.focused && stored?.isEnabled && remembered) {
        const edited = findProfileByName(profiles, remembered.name);
        if (
          edited &&
          !sameValues(edited, remembered) &&
          settingsMatch(settings, profileSettingValues(remembered))
        ) {
          // The remembered values change only once the apply succeeds.
          await this.applySettings(edited);
          await this.writeState({ isEnabled: true, currentProfile: edited });
          return;
        }
      }

      if (!this.settingsHoldProxy()) {
        if (stored?.isEnabled) {
          await this.writeState({ isEnabled: false });
        }
        return;
      }

      const current = findCurrentProfile(profiles, remembered);
      const matching = [...(current ? [current] : []), ...sortByName(profiles)].find((profile) =>
        settingsMatch(settings, profileSettingValues(profile))
      );
      const inStep =
        stored?.isEnabled === true &&
        remembered !== undefined &&
        matching !== undefined &&
        sameName(remembered.name, matching.name) &&
        sameValues(remembered, matching);
      if (matching && !inStep) {
        await this.writeState({ isEnabled: true, currentProfile: matching });
      }
    });
  }

  // Whether VS Code's settings hold a proxy at all.
  settingsHoldProxy(): boolean {
    const { proxy } = this.httpSettings.read();
    return typeof proxy === 'string' && proxy.trim().length > 0;
  }

  // Drift: while at least one profile exists, VS Code's settings carry a proxy that matches no
  // profile. Drift never changes the record.
  hasDrift(): boolean {
    const profiles = this.getProfiles();
    const settings = this.httpSettings.read();
    return (
      profiles.length > 0 &&
      this.settingsHoldProxy() &&
      !profiles.some((profile) => settingsMatch(settings, profileSettingValues(profile)))
    );
  }

  getState(): ToggleState {
    const stored = this.storedRecord();
    const profiles = readProfiles(this.profilesSetting.read());
    const currentProfile = findCurrentProfile(profiles, stored?.currentProfile);
    const state = { isEnabled: stored?.isEnabled ?? false, hasConfiguration: profiles.length > 0 };
    return currentProfile ? { ...state, currentProfile } : state;
  }

  // The profiles the switcher shows, in the order of the setting.
  getProfiles(): Profile[] {
    return readProfiles(this.profilesSetting.read());
  }

  // Every name an entry holds, valid or not; new names must avoid them all.
  getEntryNames(): string[] {
    return entryNames(this.profileEntries());
  }

  // The entries of proxyToggler.profiles that the switcher hides, and why.
  getHiddenProfiles(): FlaggedEntry[] {
    return checkProfiles(this.profilesSetting.read()).flagged;
  }

  hasConfiguration(): boolean {
    return this.getState().hasConfiguration;
  }

  // Runs state changes one at a time, in call order. The queue waits for each change to settle,
  // so a failed change still reaches its caller and does not block the next one.
  private serialize<T>(change: () => Promise<T>): Promise<T> {
    const result = this.lastChange.then(change);
    this.lastChange = Promise.allSettled([result]);
    return result;
  }

  private async enable(): Promise<void> {
    const current = this.getState().currentProfile;
    if (!current) {
      throw new Error('No proxy configuration found');
    }

    await this.applySettings(current);
    // Turning on is a UI action, so it remembers the profile even when it was only the fallback.
    await this.writeState({ isEnabled: true, currentProfile: current });
  }

  private async disable(): Promise<void> {
    await this.clearSettings();
    await this.writeState({ isEnabled: false });
  }

  private async applySettings(profile: Profile): Promise<void> {
    await this.noticeRemovedCredentials();
    await this.writing(() => this.settingsWriter.apply(profileSettingValues(profile)));
  }

  private async clearSettings(): Promise<void> {
    await this.noticeRemovedCredentials();
    await this.writing(() => this.settingsWriter.clear());
  }

  // Marks a write as this window's own for as long as it is under way. VS Code fires the change
  // event before the write resolves, so the event arrives while it is marked (ADR 0004).
  private async writing(write: () => Promise<void>): Promise<void> {
    this.ownWrites += 1;
    try {
      await write();
    } finally {
      this.ownWrites -= 1;
    }
  }

  // Profiles hold no credentials, so a write always removes any that http.proxy holds.
  private async noticeRemovedCredentials(): Promise<void> {
    if (hasCredentials(this.httpSettings.readUserSettings().proxy)) {
      await this.notices.credentialsWillBeRemoved();
    }
  }

  private alreadyMigrated(values: Omit<Profile, 'name'>): boolean {
    const marker = this.globalState.get<Omit<Profile, 'name'>>(STORAGE_KEYS.migratedProxy);
    return marker !== undefined && sameValues({ name: '', ...marker }, { name: '', ...values });
  }

  private profileEntries(): readonly unknown[] {
    const value = this.profilesSetting.read();
    return Array.isArray(value) ? value : [];
  }

  private storedRecord(): StoredRecord | undefined {
    return this.records.get<StoredRecord>(STORAGE_KEYS.toggleState);
  }

  // Writes the stored record, never the computed state, so a fallback current profile is never
  // saved. Spread rather than pick, so fields written by other versions survive the write.
  private async writeState(change: StoredRecord): Promise<void> {
    const { isEnabled, hasConfiguration } = this.getState();
    await this.records.update(STORAGE_KEYS.toggleState, {
      ...this.storedRecord(),
      isEnabled,
      hasConfiguration,
      ...change
    });
  }
}

// The values of a 0.1.x configuration, or undefined when there is none or it cannot be used.
function savedProxyValues(saved: unknown): Omit<Profile, 'name'> | undefined {
  if (typeof saved !== 'object' || saved === null) {
    return undefined;
  }

  const { proxyUrl, strictSSL, noProxy } = saved as Record<string, unknown>;
  if (typeof proxyUrl !== 'string' || typeof strictSSL !== 'boolean') {
    return undefined;
  }

  if (problemWith(() => validateProxyUrl(proxyUrl)) !== undefined) {
    return undefined;
  }

  return { proxyUrl, strictSSL, bypassList: parseNoProxyList(noProxy) };
}

function hostOf(proxyUrl: string): string {
  return new URL(proxyUrl).hostname;
}
