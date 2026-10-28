import * as os from 'node:os';
import * as path from 'node:path';

import type { ProfilesSetting } from '../../src/core/profiles';
import type { Memento } from '../../src/core/proxy-manager';
import type { HttpSettingKey, HttpSettings } from '../../src/core/proxy-settings-writer';
import type { ExtensionContext, SecretStorage } from '../../src/vscode/api';
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

export type SecretStorageFailures = { get?: Error; delete?: Error };

function createSecretStorage(
  values = new Map<string, string>(),
  failures: SecretStorageFailures = {}
): SecretStorage {
  return {
    get: async (key) => {
      if (failures.get) {
        throw failures.get;
      }
      return values.get(key);
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

export type FakeProfilesSetting = ProfilesSetting & {
  value: unknown;
  writes: unknown[][];
};

export function createProfilesSetting(value?: unknown): FakeProfilesSetting {
  const setting: FakeProfilesSetting = {
    value,
    writes: [],
    read: () => setting.value,
    write: async (entries) => {
      setting.writes.push([...entries]);
      setting.value = [...entries];
    }
  };
  return setting;
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
  inform(kind: RecordedNotification['kind'], message: string): void;
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
    showError: record('error'),
    inform: (kind, message) => {
      notifications.push({ kind, message, actions: [] });
    }
  };
}

export function createExtensionContext(
  stores: {
    state?: Map<string, unknown>;
    secrets?: Map<string, string>;
    secretFailures?: SecretStorageFailures;
    // The extension's global storage folder; on the remote machine in a remote window.
    globalStorage?: string;
  } = {}
): ExtensionContext & { globalState: FakeMemento } {
  return {
    subscriptions: [],
    globalState: createMemento(stores.state),
    secrets: createSecretStorage(stores.secrets, stores.secretFailures),
    globalStorageUri: {
      fsPath: stores.globalStorage ?? path.join(os.tmpdir(), 'proxy-toggler-unused-global-storage')
    }
  };
}

// Background work started during activation settles once pending callbacks have run.
export async function flushBackgroundTasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
