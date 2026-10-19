import type * as vscode from 'vscode';

import type { KeychainService } from './keychain-service';
import { parseNoProxyList, withDefaultNoProxy } from './no-proxy';
import type { ProxyConfiguration, ProxyCredentials, ToggleState } from './proxy-configuration';
import { validateCredentials, validateNoProxyList, validateProxyUrl } from './validation';

const STORAGE_KEYS = {
  proxyConfig: 'proxyToggler.savedProxy',
  toggleState: 'proxyToggler.state'
} as const;

// Written in this order on enable and disable.
const HTTP_SETTING_KEYS = ['proxy', 'proxyStrictSSL', 'noProxy'] as const;

export type HttpSettingKey = (typeof HTTP_SETTING_KEYS)[number];

type HttpSettingValues = Record<HttpSettingKey, string | boolean | undefined>;

export type Memento = Pick<vscode.Memento, 'get' | 'update'>;

export type CredentialStore = Pick<
  KeychainService,
  'storeCredentials' | 'clearCredentials' | 'hasCredentials'
>;

export type HttpSettings = {
  read(): Record<HttpSettingKey, unknown>;
  update(key: HttpSettingKey, value: string | boolean | undefined): Promise<void>;
};

export type LoadedProxyConfiguration = ProxyConfiguration & {
  hasStoredCredentials: boolean;
};

export type CredentialsUpdate =
  { mode: 'keep' } | { mode: 'clear' } | { mode: 'set'; credentials: ProxyCredentials };

export class ConfigurationError extends Error {
  constructor(
    public readonly operation: 'enable' | 'disable',
    public readonly key: HttpSettingKey,
    options?: ErrorOptions
  ) {
    super(
      `Failed to ${operation} proxy: unable to update VS Code setting "${formatHttpSettingKey(key)}".`,
      options
    );
    this.name = 'ConfigurationError';
  }

  toUserMessage(): string {
    return `Unable to ${this.operation} the proxy because VS Code setting "${this.getSettingId()}" could not be updated. Your settings may be managed by policy.`;
  }

  getSettingId(): string {
    return formatHttpSettingKey(this.key);
  }
}

// Credentials go through KeychainService only; never write them to settings or globalState.
export class ProxyManager {
  constructor(
    private readonly globalState: Memento,
    private readonly keychainService: CredentialStore,
    private readonly httpSettings: HttpSettings
  ) {}

  async saveConfiguration(
    configuration: ProxyConfiguration,
    credentialsUpdate: CredentialsUpdate
  ): Promise<void> {
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

  async enableProxy(): Promise<void> {
    const configuration = this.savedConfiguration();
    if (!configuration) {
      throw new Error('No proxy configuration found');
    }

    await this.writeHttpSettings('enable', {
      proxy: configuration.proxyUrl,
      proxyStrictSSL: configuration.strictSSL,
      noProxy: configuration.noProxy
    });
    await this.writeState({ isEnabled: true });
  }

  async disableProxy(): Promise<void> {
    await this.writeHttpSettings('disable', {
      proxy: undefined,
      proxyStrictSSL: undefined,
      noProxy: undefined
    });
    await this.writeState({ isEnabled: false });
  }

  async toggleProxy(): Promise<boolean> {
    if (!this.hasConfiguration()) {
      throw new Error('No proxy configuration found');
    }

    if (this.getState().isEnabled) {
      await this.disableProxy();
      return false;
    }

    await this.enableProxy();
    return true;
  }

  // Records the state found in VS Code settings without writing those settings. It reads them
  // itself, so a caller that waited on a prompt cannot record a stale state.
  async syncToggleState(): Promise<void> {
    const isEnabled = this.isConfigurationApplied();
    if (this.getState().isEnabled !== isEnabled) {
      await this.writeState({ isEnabled });
    }
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

  private savedConfiguration(): ProxyConfiguration | undefined {
    return this.globalState.get<ProxyConfiguration>(STORAGE_KEYS.proxyConfig);
  }

  private async writeState(change: Partial<ToggleState>): Promise<void> {
    await this.globalState.update(STORAGE_KEYS.toggleState, { ...this.getState(), ...change });
  }

  private async writeHttpSettings(
    operation: ConfigurationError['operation'],
    values: HttpSettingValues
  ): Promise<void> {
    for (const key of HTTP_SETTING_KEYS) {
      try {
        await this.httpSettings.update(key, values[key]);
      } catch (error: unknown) {
        throw new ConfigurationError(operation, key, { cause: error });
      }
    }
  }
}

function formatHttpSettingKey(key: HttpSettingKey): string {
  return `http.${key}`;
}
