import type * as vscode from 'vscode';

import type { KeychainService } from './keychain-service';
import { parseNoProxyList } from './no-proxy';
import type { ProxyConfiguration, ProxyCredentials } from './proxy-configuration';
import type { ToggleState } from './toggle-state';
import { ValidationService } from './validation-service';

const DEFAULT_NO_PROXY = 'localhost,127.0.0.1';

const STORAGE_KEYS = {
  proxyConfig: 'proxyToggler.savedProxy',
  toggleState: 'proxyToggler.state'
} as const;

export type Memento = Pick<vscode.Memento, 'get' | 'update'>;

export type CredentialStore = Pick<
  KeychainService,
  'storeCredentials' | 'clearCredentials' | 'hasCredentials'
>;

export type HttpSettingKey = 'proxy' | 'proxyStrictSSL' | 'noProxy';

export type HttpSettings = {
  read(): Record<HttpSettingKey, unknown>;
  update(key: HttpSettingKey, value: string | boolean | undefined): Promise<void>;
};

export type LoadedProxyConfiguration = ProxyConfiguration & {
  hasStoredCredentials: boolean;
};

export type SaveConfigurationOptions =
  | {
      configuration: ProxyConfiguration;
      credentials: ProxyCredentials;
      clearCredentials?: never;
    }
  | {
      configuration: ProxyConfiguration;
      clearCredentials: true;
      credentials?: never;
    }
  | {
      configuration: ProxyConfiguration;
      credentials?: undefined;
      clearCredentials?: undefined;
    };

export class ConfigurationError extends Error {
  constructor(
    public readonly operation: 'enable' | 'disable',
    public readonly key: HttpSettingKey,
    public override readonly cause?: Error
  ) {
    super(
      `Failed to ${operation} proxy: unable to update VS Code setting "${formatHttpSettingKey(key)}".`
    );
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toUserMessage(): string {
    const action = this.operation === 'enable' ? 'enable' : 'disable';
    return `Unable to ${action} the proxy because VS Code setting "${formatHttpSettingKey(this.key)}" could not be updated. Your settings may be managed by policy.`;
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

  dispose(): void {
    // No-op: ProxyManager holds no unmanaged resources.
  }

  async saveConfiguration(options: SaveConfigurationOptions): Promise<void> {
    const normalizedConfiguration = normalizeConfiguration(options.configuration);

    ValidationService.validateProxyUrl(normalizedConfiguration.proxyUrl);
    ValidationService.validateNoProxyPattern(normalizedConfiguration.noProxy);

    if (hasCredentialUpdate(options)) {
      ValidationService.validateCredentials(
        options.credentials.username,
        options.credentials.password
      );
    }

    await this.globalState.update(STORAGE_KEYS.proxyConfig, normalizedConfiguration);

    if (hasCredentialUpdate(options)) {
      await this.keychainService.storeCredentials(
        options.credentials.username,
        options.credentials.password
      );
    } else if (options.clearCredentials === true) {
      await this.keychainService.clearCredentials();
    }

    const nextState: ToggleState = {
      ...this.getState(),
      hasConfiguration: true
    };

    await this.globalState.update(STORAGE_KEYS.toggleState, nextState);
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

    await this.updateHttpSetting('enable', 'proxy', configuration.proxyUrl);
    await this.updateHttpSetting('enable', 'proxyStrictSSL', configuration.strictSSL);
    await this.updateHttpSetting('enable', 'noProxy', configuration.noProxy);

    await this.globalState.update(STORAGE_KEYS.toggleState, {
      ...this.getState(),
      isEnabled: true
    });
  }

  async disableProxy(): Promise<void> {
    await this.updateHttpSetting('disable', 'proxy', undefined);
    await this.updateHttpSetting('disable', 'proxyStrictSSL', undefined);
    await this.updateHttpSetting('disable', 'noProxy', undefined);

    await this.globalState.update(STORAGE_KEYS.toggleState, {
      ...this.getState(),
      isEnabled: false
    });
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

  // Records the state found in VS Code settings without writing those settings.
  async syncToggleState(isEnabled: boolean): Promise<void> {
    await this.globalState.update(STORAGE_KEYS.toggleState, {
      ...this.getState(),
      isEnabled
    });
  }

  getState(): ToggleState {
    const stored = this.globalState.get<ToggleState>(STORAGE_KEYS.toggleState);
    const hasConfiguration = Boolean(this.savedConfiguration());

    if (stored) {
      return {
        ...stored,
        hasConfiguration
      };
    }

    return {
      isEnabled: false,
      hasConfiguration
    };
  }

  hasConfiguration(): boolean {
    return this.getState().hasConfiguration;
  }

  private savedConfiguration(): ProxyConfiguration | undefined {
    return this.globalState.get<ProxyConfiguration>(STORAGE_KEYS.proxyConfig);
  }

  private async updateHttpSetting(
    operation: ConfigurationError['operation'],
    key: HttpSettingKey,
    value: string | boolean | undefined
  ): Promise<void> {
    try {
      await this.httpSettings.update(key, value);
    } catch (error: unknown) {
      throw new ConfigurationError(operation, key, asError(error));
    }
  }
}

function formatHttpSettingKey(key: HttpSettingKey): string {
  return `http.${key}`;
}

function asError(error: unknown): Error | undefined {
  return error instanceof Error ? error : undefined;
}

function hasCredentialUpdate(
  options: SaveConfigurationOptions
): options is { configuration: ProxyConfiguration; credentials: ProxyCredentials } {
  return options.credentials !== undefined;
}

function normalizeConfiguration(configuration: ProxyConfiguration): ProxyConfiguration {
  return {
    proxyUrl: configuration.proxyUrl.trim(),
    strictSSL: configuration.strictSSL,
    noProxy: normalizeNoProxyValue(configuration.noProxy)
  };
}

function normalizeNoProxyValue(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_NO_PROXY;
}
