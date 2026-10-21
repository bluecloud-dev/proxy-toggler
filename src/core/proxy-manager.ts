import type * as vscode from 'vscode';

import type { KeychainService } from './keychain-service';
import { settingsMatch } from './match';
import { parseNoProxyList, withDefaultNoProxy } from './no-proxy';
import {
  defaultProfileName,
  entryNames,
  findCurrentProfile,
  type Profile,
  profileSettingValues,
  type ProfilesSetting,
  readProfiles,
  sameValues,
  withProfile
} from './profiles';
import type { ProxyConfiguration, ProxyCredentials, ToggleState } from './proxy-configuration';
import { type HttpSettings, ProxySettingsWriter } from './proxy-settings-writer';
import { validateCredentials, validateNoProxyList, validateProxyUrl } from './validation';

const STORAGE_KEYS = {
  // 0.1.x's configuration, which v0.2.0 reads and never writes or deletes (ADR 0001).
  savedProxy: 'proxyToggler.savedProxy',
  // The savedProxy values whose copy a later read showed; per VS Code Profile, like savedProxy.
  migratedProxy: 'proxyToggler.migratedProxy',
  toggleState: 'proxyToggler.state'
} as const;

export type Memento = Pick<vscode.Memento, 'get' | 'update'>;

export type CredentialStore = Pick<
  KeychainService,
  'storeCredentials' | 'clearCredentials' | 'hasCredentials'
>;

export type LoadedProxyConfiguration = ProxyConfiguration & {
  hasStoredCredentials: boolean;
};

export type CredentialsUpdate =
  { mode: 'keep' } | { mode: 'clear' } | { mode: 'set'; credentials: ProxyCredentials };

// The record of the local proxy settings (GLOSSARY.md), per VS Code Profile. 0.1.x wrote
// isEnabled and hasConfiguration and keeps fields it does not know, such as currentProfile, which
// remembers the current profile by name and values.
type StoredRecord = {
  isEnabled?: boolean;
  hasConfiguration?: boolean;
  currentProfile?: Profile;
};

// Credentials go through KeychainService only; never write them to settings or globalState.
export class ProxyManager {
  // Settles once the most recent state change has settled; see serialize().
  private lastChange: Promise<unknown> = Promise.resolve();
  private readonly settingsWriter: ProxySettingsWriter;

  constructor(
    private readonly globalState: Memento,
    private readonly keychainService: CredentialStore,
    private readonly httpSettings: HttpSettings,
    private readonly profilesSetting: ProfilesSetting
  ) {
    this.settingsWriter = new ProxySettingsWriter(httpSettings);
  }

  saveConfiguration(
    configuration: ProxyConfiguration,
    credentialsUpdate: CredentialsUpdate
  ): Promise<void> {
    return this.serialize(async () => {
      const normalized: ProxyConfiguration = {
        proxyUrl: configuration.proxyUrl.trim(),
        strictSSL: configuration.strictSSL,
        noProxy: withDefaultNoProxy(configuration.noProxy)
      };

      validateProxyUrl(normalized.proxyUrl);
      validateNoProxyList(normalized.noProxy);
      if (credentialsUpdate.mode === 'set') {
        const { username, password } = credentialsUpdate.credentials;
        validateCredentials(username, password);
      }

      // Configure edits the current profile, or adds the first one, named after its host.
      const current = this.getState().currentProfile;
      const entries = this.profileEntries();
      const profile: Profile = {
        name: current?.name ?? defaultProfileName(hostOf(normalized.proxyUrl), entryNames(entries)),
        proxyUrl: normalized.proxyUrl,
        strictSSL: normalized.strictSSL,
        bypassList: parseNoProxyList(normalized.noProxy)
      };
      await this.profilesSetting.write(withProfile(entries, profile, current?.name));

      if (credentialsUpdate.mode === 'set') {
        const { username, password } = credentialsUpdate.credentials;
        await this.keychainService.storeCredentials(username, password);
      } else if (credentialsUpdate.mode === 'clear') {
        await this.keychainService.clearCredentials();
      }

      await this.writeState({ currentProfile: profile });
    });
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
        await this.profilesSetting.write([...entries, profile]);
      }
      // A VS Code Profile without a current profile starts with the one it used in 0.1.x.
      if (!this.storedRecord()?.currentProfile) {
        await this.writeState({ currentProfile: profile });
      }
    });
  }

  async loadConfiguration(): Promise<LoadedProxyConfiguration | undefined> {
    const current = this.getState().currentProfile;
    if (!current) {
      return undefined;
    }

    return {
      proxyUrl: current.proxyUrl,
      strictSSL: current.strictSSL,
      noProxy: current.bypassList.join(','),
      hasStoredCredentials: await this.keychainService.hasCredentials()
    };
  }

  // Reads settings and globalState only, never SecretStorage, so activation can call it.
  isConfigurationApplied(): boolean {
    const current = this.getState().currentProfile;
    return (
      current !== undefined &&
      settingsMatch(this.httpSettings.read(), profileSettingValues(current))
    );
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

  // Records the state found in VS Code settings without writing those settings. It reads them
  // itself, so a caller that waited on a prompt cannot record a stale state.
  syncToggleState(): Promise<void> {
    return this.serialize(async () => {
      const isEnabled = this.isConfigurationApplied();
      if (this.getState().isEnabled !== isEnabled) {
        await this.writeState({ isEnabled });
      }
    });
  }

  getState(): ToggleState {
    const stored = this.storedRecord();
    const profiles = readProfiles(this.profilesSetting.read());
    const currentProfile = findCurrentProfile(profiles, stored?.currentProfile);
    const state = { isEnabled: stored?.isEnabled ?? false, hasConfiguration: profiles.length > 0 };
    return currentProfile ? { ...state, currentProfile } : state;
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

    await this.settingsWriter.apply(profileSettingValues(current));
    // Turning on is a UI action, so it remembers the profile even when it was only the fallback.
    await this.writeState({ isEnabled: true, currentProfile: current });
  }

  private async disable(): Promise<void> {
    await this.settingsWriter.clear();
    await this.writeState({ isEnabled: false });
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
    return this.globalState.get<StoredRecord>(STORAGE_KEYS.toggleState);
  }

  // Writes the stored record, never the computed state, so a fallback current profile is never
  // saved. Spread rather than pick, so fields written by other versions survive the write.
  private async writeState(change: StoredRecord): Promise<void> {
    const { isEnabled, hasConfiguration } = this.getState();
    await this.globalState.update(STORAGE_KEYS.toggleState, {
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

  try {
    validateProxyUrl(proxyUrl);
  } catch {
    return undefined;
  }

  return { proxyUrl, strictSSL, bypassList: parseNoProxyList(noProxy) };
}

function hostOf(proxyUrl: string): string {
  return new URL(proxyUrl).hostname;
}
