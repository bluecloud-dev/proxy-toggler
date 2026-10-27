// Written in this order on enable and disable, and restored in this order after a failed enable.
const HTTP_SETTING_KEYS = ['proxy', 'proxyStrictSSL', 'noProxy'] as const;

export type HttpSettingKey = (typeof HTTP_SETTING_KEYS)[number];

export type HttpSettings = {
  // Effective values, defaults and workspace settings included.
  read(): Record<HttpSettingKey, unknown>;
  // Values in user settings, the target that update writes; undefined where there is none.
  readUserSettings(): Record<HttpSettingKey, unknown>;
  update(key: HttpSettingKey, value: unknown): Promise<void>;
};

export type ProxySettingValues = {
  proxy: string;
  proxyStrictSSL: boolean;
  // A comma-separated string or a list; VS Code's setting is a list.
  noProxy: string | readonly string[];
};

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

  toUserMessage(action = `Unable to ${this.operation} the proxy`): string {
    const message = `${action} because VS Code setting "${this.getSettingId()}" could not be updated. Your settings may be managed by policy.`;
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

// The failed setting write behind an error, found through `cause` when another error wraps it,
// as ProfileApplyError does.
export function failedSettingWrite(error: unknown): ConfigurationError | undefined {
  // A cause chain can lead back to an error already seen.
  const seen = new Set<Error>();
  let current = error;
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof ConfigurationError) {
      return current;
    }
    seen.add(current);
    current = current.cause;
  }
  return undefined;
}

// Writes and clears VS Code's proxy settings. It stores nothing; callers keep their own record.
export class ProxySettingsWriter {
  constructor(private readonly httpSettings: HttpSettings) {}

  // A failed write first restores the settings already written, so applying never leaves the
  // proxy half applied. See ARCHITECTURE.md (Error model).
  async apply(values: ProxySettingValues): Promise<void> {
    const previous = this.httpSettings.readUserSettings();
    for (const [index, key] of HTTP_SETTING_KEYS.entries()) {
      try {
        await this.httpSettings.update(key, values[key]);
      } catch (error: unknown) {
        const restoreErrors = await this.restore(HTTP_SETTING_KEYS.slice(0, index), previous);
        throw new ConfigurationError('enable', key, { cause: error }, restoreErrors);
      }
    }
  }

  // A failed clear restores nothing, so once http.proxy is cleared the proxy stays off.
  async clear(): Promise<void> {
    for (const key of HTTP_SETTING_KEYS) {
      try {
        await this.httpSettings.update(key, undefined);
      } catch (error: unknown) {
        throw new ConfigurationError('disable', key, { cause: error });
      }
    }
  }

  // Keeps going when a restore fails, so one failure does not leave the other settings changed.
  private async restore(
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
