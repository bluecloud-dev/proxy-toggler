import type { SecretStorage } from '../../src/core/keychain-service';
import type { HttpSettingKey, HttpSettings, Memento } from '../../src/core/proxy-manager';
import type { ExtensionContext } from '../../src/vscode/api';
import type { NotificationAction } from '../../src/vscode/notification-service';

export type FakeMemento = Memento & {
  store: Map<string, unknown>;
  updates: Array<{ key: string; value: unknown }>;
};

export function createMemento(store = new Map<string, unknown>()): FakeMemento {
  const updates: FakeMemento['updates'] = [];
  return {
    store,
    updates,
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      const value = store.get(key) as T | undefined;
      return value === undefined ? defaultValue : value;
    },
    update: async (key: string, value: unknown): Promise<void> => {
      updates.push({ key, value });
      store.set(key, value);
    }
  };
}

export type SecretStorageFailures = { get?: Error; store?: Error; delete?: Error };

export function createSecretStorage(
  values = new Map<string, string>(),
  failures: SecretStorageFailures = {}
): SecretStorage & { values: Map<string, string> } {
  return {
    values,
    get: async (key) => {
      if (failures.get) {
        throw failures.get;
      }
      return values.get(key);
    },
    store: async (key, value) => {
      if (failures.store) {
        throw failures.store;
      }
      values.set(key, value);
    },
    delete: async (key) => {
      if (failures.delete) {
        throw failures.delete;
      }
      values.delete(key);
    }
  };
}

export type FakeHttpSettings = HttpSettings & {
  current: Record<HttpSettingKey, unknown>;
  updates: Array<{ key: HttpSettingKey; value: unknown }>;
};

export function createHttpSettings(
  options: {
    // Every write to this setting fails.
    failKey?: HttpSettingKey;
    // Writes it matches fail, for failures that depend on the value written.
    failWhen?: (update: { key: HttpSettingKey; value: unknown }) => boolean;
    // User settings; a key left out is unset.
    current?: Partial<Record<HttpSettingKey, unknown>>;
    // What VS Code reports for a setting nobody has set: read() falls back to these, while
    // readUserSettings() does not.
    defaults?: Partial<Record<HttpSettingKey, unknown>>;
  } = {}
): FakeHttpSettings {
  const current = {
    proxy: undefined,
    proxyStrictSSL: undefined,
    noProxy: undefined,
    ...options.current
  };
  const defaults = options.defaults ?? {};
  const updates: FakeHttpSettings['updates'] = [];
  return {
    current,
    updates,
    read: () => ({
      proxy: current.proxy ?? defaults.proxy,
      proxyStrictSSL: current.proxyStrictSSL ?? defaults.proxyStrictSSL,
      noProxy: current.noProxy ?? defaults.noProxy
    }),
    readUserSettings: () => ({ ...current }),
    update: async (key, value) => {
      updates.push({ key, value });
      if (options.failKey === key || options.failWhen?.({ key, value })) {
        throw new Error(`Failed to update ${key}`);
      }
      current[key] = value;
    }
  };
}

export type RecordedNotification = {
  kind: 'success' | 'warning' | 'error';
  message: string;
  actions: NotificationAction[];
};

// Stands in for NotificationService; `choose` returns the id of the clicked action.
export function createNotificationRecorder(
  choose: (notification: RecordedNotification) => string | undefined = () => undefined
): {
  notifications: RecordedNotification[];
  showSuccess(message: string, ...actions: NotificationAction[]): Promise<string | undefined>;
  showWarning(message: string, ...actions: NotificationAction[]): Promise<string | undefined>;
  showError(message: string, ...actions: NotificationAction[]): Promise<string | undefined>;
} {
  const notifications: RecordedNotification[] = [];
  const record =
    (kind: RecordedNotification['kind']) =>
    async (message: string, ...actions: NotificationAction[]): Promise<string | undefined> => {
      const notification = { kind, message, actions };
      notifications.push(notification);
      return choose(notification);
    };

  return {
    notifications,
    showSuccess: record('success'),
    showWarning: record('warning'),
    showError: record('error')
  };
}

export function createExtensionContext(
  stores: {
    state?: Map<string, unknown>;
    secrets?: Map<string, string>;
    secretFailures?: SecretStorageFailures;
  } = {}
): ExtensionContext & { globalState: FakeMemento } {
  return {
    subscriptions: [],
    globalState: createMemento(stores.state),
    secrets: createSecretStorage(stores.secrets, stores.secretFailures)
  };
}

// Background work started during activation settles once pending callbacks have run.
export async function flushBackgroundTasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
