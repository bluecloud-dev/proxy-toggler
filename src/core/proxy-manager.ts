import type * as vscode from 'vscode';

import type { KeychainService } from './keychain-service';
import { parseNoProxyList, withDefaultNoProxy } from './no-proxy';
import type { ProxyConfiguration, ProxyCredentials, ToggleState } from './proxy-configuration';
import { validateCredentials, validateNoProxyList, validateProxyUrl } from './validation';

const STORAGE_KEYS = {
  proxyConfig: 'proxyToggler.savedProxy',
  toggleState: 'proxyToggler.state'
} as const;

// Written in this order on enable and disable, and restored in this order after a failed enable.
const HTTP_SETTING_KEYS = ['proxy', 'proxyStrictSSL', 'noProxy'] as const;

export type HttpSettingKey = (typeof HTTP_SETTING_KEYS)[number];

type HttpSettingValues = Record<HttpSettingKey, string | boolean | undefined>;

export type Memento = Pick<vscode.Memento, 'get' | 'update'>;

export type CredentialStore = Pick<
  KeychainService,
  'storeCredentials' | 'clearCredentials' | 'hasCredentials'
>;

export type HttpSettings = {
  // Effective values, defaults and workspace settings included.
  read(): Record<HttpSettingKey, unknown>;
  // Values in user settings, the target that update writes; undefined where there is none.
  readUserSettings(): Record<HttpSettingKey, unknown>;
  update(key: HttpSettingKey, value: unknown): Promise<void>;
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
    options?: ErrorOptions,
    // Settings a failed enable could not restore, each with the error its restore raised.
    public readonly restoreErrors: ReadonlyMap<HttpSettingKey, unknown> = new Map()
  ) {
    super(
      `Failed to ${operation} proxy: unable to update VS Code setting "${formatHttpSettingKey(key)}".`,
      options
    );
    this.name = 'ConfigurationError';
  }

  toUserMessage(): string {
    const message = `Unable to ${this.operation} the proxy because VS Code setting "${this.getSettingId()}" could not be updated. Your settings may be managed by policy.`;
    if (this.restoreErrors.size === 0) {
      return message;
    }

    const unrestored = [...this.restoreErrors.keys()]
      .map((key) => `"${formatHttpSettingKey(key)}"`)
      .join(', ');
    return `${message} Settings that could not be restored to their earlier values: ${unrestored}.`;
  }

  getSettingId(): string {
    return formatHttpSettingKey(this.key);
  }
}

// Credentials go through KeychainService only; never write them to settings or globalState.
export class ProxyManager {
  // Settles once the most recent state change has settled; see serialize().
  private lastChange: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly globalState: Memento,
    private readonly keychainService: CredentialStore,
    private readonly httpSettings: HttpSettings
  ) {}

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

    await this.writeHttpSettings(
      'enable',
      {
        proxy: configuration.proxyUrl,
        proxyStrictSSL: configuration.strictSSL,
        noProxy: configuration.noProxy
      },
      this.httpSettings.readUserSettings()
    );
    await this.writeState({ isEnabled: true });
  }

  private async disable(): Promise<void> {
    await this.writeHttpSettings('disable', {
      proxy: undefined,
      proxyStrictSSL: undefined,
      noProxy: undefined
    });
    await this.writeState({ isEnabled: false });
  }

  private savedConfiguration(): ProxyConfiguration | undefined {
    return this.globalState.get<ProxyConfiguration>(STORAGE_KEYS.proxyConfig);
  }

  private async writeState(change: Partial<ToggleState>): Promise<void> {
    await this.globalState.update(STORAGE_KEYS.toggleState, { ...this.getState(), ...change });
  }

  // Given `previous`, a failed write first restores the settings already written, so enabling
  // never leaves the proxy half applied. See ARCHITECTURE.md (Error model).
  private async writeHttpSettings(
    operation: ConfigurationError['operation'],
    values: HttpSettingValues,
    previous?: Record<HttpSettingKey, unknown>
  ): Promise<void> {
    for (const [index, key] of HTTP_SETTING_KEYS.entries()) {
      try {
        await this.httpSettings.update(key, values[key]);
      } catch (error: unknown) {
        const restoreErrors = previous
          ? await this.restoreHttpSettings(HTTP_SETTING_KEYS.slice(0, index), previous)
          : undefined;
        throw new ConfigurationError(operation, key, { cause: error }, restoreErrors);
      }
    }
  }

  // Keeps going when a restore fails, so one failure does not leave the other settings changed.
  private async restoreHttpSettings(
    keys: readonly HttpSettingKey[],
    previous: Record<HttpSettingKey, unknown>
  ): Promise<Map<HttpSettingKey, unknown>> {
    const restoreErrors = new Map<HttpSettingKey, unknown>();
    for (const key of keys) {
      try {
        await this.httpSettings.update(key, previous[key]);
      } catch (error: unknown) {
        restoreErrors.set(key, error);
      }
    }
    return restoreErrors;
  }
}

function formatHttpSettingKey(key: HttpSettingKey): string {
  return `http.${key}`;
}
