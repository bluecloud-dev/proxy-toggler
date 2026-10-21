import type * as vscode from 'vscode';

import type { KeychainService } from './keychain-service';
import { parseNoProxyList, withDefaultNoProxy } from './no-proxy';
import type { ProxyConfiguration, ProxyCredentials, ToggleState } from './proxy-configuration';
import { type HttpSettings, ProxySettingsWriter } from './proxy-settings-writer';
import { validateCredentials, validateNoProxyList, validateProxyUrl } from './validation';

const STORAGE_KEYS = {
  proxyConfig: 'proxyToggler.savedProxy',
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

// Credentials go through KeychainService only; never write them to settings or globalState.
export class ProxyManager {
  // Settles once the most recent state change has settled; see serialize().
  private lastChange: Promise<unknown> = Promise.resolve();
  private readonly settingsWriter: ProxySettingsWriter;

  constructor(
    private readonly globalState: Memento,
    private readonly keychainService: CredentialStore,
    private readonly httpSettings: HttpSettings
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

      await this.globalState.update(STORAGE_KEYS.proxyConfig, normalized);

      if (credentialsUpdate.mode === 'set') {
        const { username, password } = credentialsUpdate.credentials;
        await this.keychainService.storeCredentials(username, password);
      } else if (credentialsUpdate.mode === 'clear') {
        await this.keychainService.clearCredentials();
      }

      await this.writeState({ hasConfiguration: true });
    });
  }

  async loadConfiguration(): Promise<LoadedProxyConfiguration | undefined> {
    const saved = this.savedConfiguration();
    if (!saved) {
      return undefined;
    }

    return {
      ...saved,
      hasStoredCredentials: await this.keychainService.hasCredentials()
    };
  }

  // Reads settings and globalState only, never SecretStorage, so activation can call it.
  isConfigurationApplied(): boolean {
    const saved = this.savedConfiguration();
    if (!saved) {
      return false;
    }

    const current = this.httpSettings.read();
    return (
      current.proxy === saved.proxyUrl &&
      current.proxyStrictSSL === saved.strictSSL &&
      parseNoProxyList(current.noProxy).join(',') === parseNoProxyList(saved.noProxy).join(',')
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
    const stored = this.globalState.get<ToggleState>(STORAGE_KEYS.toggleState);
    const hasConfiguration = Boolean(this.savedConfiguration());
    if (!stored) {
      return { isEnabled: false, hasConfiguration };
    }

    // Spread rather than pick, so fields written by other versions survive the next write.
    return { ...stored, hasConfiguration };
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
    const configuration = this.savedConfiguration();
    if (!configuration) {
      throw new Error('No proxy configuration found');
    }

    await this.settingsWriter.apply({
      proxy: configuration.proxyUrl,
      proxyStrictSSL: configuration.strictSSL,
      noProxy: configuration.noProxy
    });
    await this.writeState({ isEnabled: true });
  }

  private async disable(): Promise<void> {
    await this.settingsWriter.clear();
    await this.writeState({ isEnabled: false });
  }

  private savedConfiguration(): ProxyConfiguration | undefined {
    return this.globalState.get<ProxyConfiguration>(STORAGE_KEYS.proxyConfig);
  }

  private async writeState(change: Partial<ToggleState>): Promise<void> {
    await this.globalState.update(STORAGE_KEYS.toggleState, { ...this.getState(), ...change });
  }
}
