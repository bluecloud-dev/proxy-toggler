import type * as vscode from 'vscode';

import type { ProxyConfiguration, ProxyCredentials } from '../types/proxy-configuration';
import type { ToggleState } from '../types/toggle-state';
import { KeychainService } from './keychain-service';
import { ValidationService } from './validation-service';

const DEFAULT_NO_PROXY = 'localhost,127.0.0.1';

const STORAGE_KEYS = {
  proxyConfig: 'proxyToggler.savedProxy',
  toggleState: 'proxyToggler.state'
} as const;

/**
 * Minimal VS Code Memento surface used by this extension.
 */
export type Memento = Pick<vscode.Memento, 'get' | 'update'>;

/**
 * VS Code `http.*` configuration keys managed by this extension.
 */
export type HttpConfigurationKey = 'proxy' | 'proxyStrictSSL' | 'noProxy';

/**
 * Minimal `http` configuration surface used by this extension.
 */
export type HttpConfiguration = {
  update: (key: HttpConfigurationKey, value: string | boolean | undefined) => Promise<void>;
};

/**
 * Loaded non-sensitive proxy configuration plus a credential presence flag.
 */
export type LoadedProxyConfiguration = ProxyConfiguration & {
  hasStoredCredentials: boolean;
};

/**
 * Options for saving proxy configuration. Credentials can be updated, cleared, or left unchanged.
 */
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
  /**
   * @param operation Whether the update happened while enabling or disabling the proxy.
   * @param key The `http.*` setting key that failed to update.
   * @param cause The original error, if available.
   * @example
   * ```ts
   * throw new ConfigurationError('enable', 'proxy', error);
   * ```
   */
  constructor(
    public readonly operation: 'enable' | 'disable',
    public readonly key: HttpConfigurationKey,
    public override readonly cause?: Error
  ) {
    super(`Failed to ${operation} proxy: unable to update VS Code setting "${formatHttpSettingKey(key)}".`);
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Returns a user-friendly message for showing in the VS Code UI.
   *
   * @returns A non-sensitive error message safe for display.
   * @example
   * ```ts
   * await notificationService.showError(error.toUserMessage());
   * ```
   */
  toUserMessage(): string {
    const action = this.operation === 'enable' ? 'enable' : 'disable';
    return `Unable to ${action} the proxy because VS Code setting "${formatHttpSettingKey(this.key)}" could not be updated. Your settings may be managed by policy.`;
  }

  /**
   * @returns The full VS Code setting ID (e.g., `http.proxy`).
   * @example
   * ```ts
   * await vscode.commands.executeCommand('workbench.action.openSettings', error.getSettingId());
   * ```
   */
  getSettingId(): string {
    return formatHttpSettingKey(this.key);
  }
}

/**
 * Persists proxy configuration and toggle state, and applies/clears VS Code `http.*` settings.
 *
 * Credentials are stored only via `KeychainService` and MUST NOT be written to settings.
 */
export class ProxyManager {
  /**
   * @param globalState VS Code globalState store for non-sensitive data.
   * @param keychainService SecretStorage wrapper for credentials.
   * @param httpConfiguration Wrapper around `workspace.getConfiguration('http')`.
   * @example
   * ```ts
   * const manager = new ProxyManager(context.globalState, keychain, httpConfig);
   * ```
   */
  constructor(
    private readonly globalState: Memento,
    private readonly keychainService: KeychainService,
    private readonly httpConfiguration: HttpConfiguration
  ) {}

  /**
   * @returns void
   * @example
   * ```ts
   * manager.dispose();
   * ```
   */
  dispose(): void {
    // No-op: ProxyManager holds no unmanaged resources.
  }

  /**
   * Saves proxy configuration and optionally updates or clears stored credentials.
   *
   * @param options Configuration and optional credential mutation.
   * @returns void
   * @throws {ValidationError} If proxy URL, credentials, or noProxy patterns are invalid.
   * @throws {KeychainError} If credential storage fails.
   * @example
   * ```ts
   * await manager.saveConfiguration({ configuration, credentials: { username, password } });
   * ```
   */
  async saveConfiguration(options: SaveConfigurationOptions): Promise<void> {
    const normalizedConfiguration = normalizeConfiguration(options.configuration);

    ValidationService.validateProxyUrl(normalizedConfiguration.proxyUrl);
    ValidationService.validateNoProxyPattern(normalizedConfiguration.noProxy);

    if (hasCredentialUpdate(options)) {
      ValidationService.validateCredentials(options.credentials.username, options.credentials.password);
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

  /**
   * Loads the saved non-sensitive configuration and indicates whether credentials exist in SecretStorage.
   *
   * @returns Saved configuration, or `undefined` if none exists.
   * @throws {KeychainError} If SecretStorage access fails.
   * @example
   * ```ts
   * const saved = await manager.loadConfiguration();
   * ```
   */
  async loadConfiguration(): Promise<LoadedProxyConfiguration | undefined> {
    const saved = this.globalState.get<ProxyConfiguration>(STORAGE_KEYS.proxyConfig);
    if (!saved) {
      return undefined;
    }

    return {
      ...saved,
      hasStoredCredentials: await this.keychainService.hasCredentials()
    };
  }

  /**
   * Loads the saved non-sensitive configuration without touching SecretStorage.
   *
   * @returns Saved configuration, or `undefined` if none exists.
   * @example
   * ```ts
   * const saved = manager.getSavedConfiguration();
   * ```
   */
  getSavedConfiguration(): ProxyConfiguration | undefined {
    return this.globalState.get<ProxyConfiguration>(STORAGE_KEYS.proxyConfig);
  }

  /**
   * Applies the saved configuration to VS Code global user settings (`http.*`).
   *
   * @returns void
   * @throws {Error} If no configuration has been saved yet.
   * @throws {ConfigurationError} If VS Code settings updates fail.
   * @example
   * ```ts
   * await manager.enableProxy();
   * ```
   */
  async enableProxy(): Promise<void> {
    const configuration = this.globalState.get<ProxyConfiguration>(STORAGE_KEYS.proxyConfig);

    if (!configuration) {
      throw new Error('No proxy configuration found');
    }

    await this.updateHttpConfiguration('enable', 'proxy', configuration.proxyUrl);
    await this.updateHttpConfiguration('enable', 'proxyStrictSSL', configuration.strictSSL);
    await this.updateHttpConfiguration('enable', 'noProxy', configuration.noProxy);

    await this.globalState.update(STORAGE_KEYS.toggleState, {
      ...this.getState(),
      isEnabled: true
    });
  }

  /**
   * Clears proxy settings from VS Code global user settings (`http.*`).
   *
   * @returns void
   * @throws {ConfigurationError} If VS Code settings updates fail.
   * @example
   * ```ts
   * await manager.disableProxy();
   * ```
   */
  async disableProxy(): Promise<void> {
    await this.updateHttpConfiguration('disable', 'proxy', undefined);
    await this.updateHttpConfiguration('disable', 'proxyStrictSSL', undefined);
    await this.updateHttpConfiguration('disable', 'noProxy', undefined);

    await this.globalState.update(STORAGE_KEYS.toggleState, {
      ...this.getState(),
      isEnabled: false
    });
  }

  /**
   * Enables or disables the proxy depending on current toggle state.
   *
   * @returns True if enabled after the call, false if disabled.
   * @throws {Error} If no configuration has been saved yet.
   * @throws {ConfigurationError} If VS Code settings updates fail.
   * @example
   * ```ts
   * const enabled = await manager.toggleProxy();
   * ```
   */
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

  /**
   * Updates only the stored toggle state, without changing VS Code settings.
   *
   * Used to sync state when drift is detected on activation.
   *
   * @param isEnabled Whether the proxy is enabled in VS Code settings.
   * @returns void
   * @example
   * ```ts
   * await manager.syncToggleState(true);
   * ```
   */
  async syncToggleState(isEnabled: boolean): Promise<void> {
    await this.globalState.update(STORAGE_KEYS.toggleState, {
      ...this.getState(),
      isEnabled
    });
  }

  /**
   * @returns Current toggle state (includes derived `hasConfiguration`).
   * @example
   * ```ts
   * const state = manager.getState();
   * ```
   */
  getState(): ToggleState {
    const stored = this.globalState.get<ToggleState>(STORAGE_KEYS.toggleState);
    const hasConfiguration = Boolean(
      this.globalState.get<ProxyConfiguration>(STORAGE_KEYS.proxyConfig)
    );

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

  /**
   * @returns True if a saved configuration exists.
   * @example
   * ```ts
   * if (!manager.hasConfiguration()) { ... }
   * ```
   */
  hasConfiguration(): boolean {
    return this.getState().hasConfiguration;
  }

  private async updateHttpConfiguration(
    operation: ConfigurationError['operation'],
    key: HttpConfigurationKey,
    value: string | boolean | undefined
  ): Promise<void> {
    try {
      await this.httpConfiguration.update(key, value);
    } catch (error: unknown) {
      throw new ConfigurationError(operation, key, asError(error));
    }
  }
}

function formatHttpSettingKey(key: HttpConfigurationKey): string {
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
