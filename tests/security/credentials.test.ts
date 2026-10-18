import { strict as assert } from 'node:assert';

import { configureProxyCommand } from '../../src/commands/configure-proxy';
import { KeychainService } from '../../src/services/keychain-service';
import type {
  LoadedProxyConfiguration,
  SaveConfigurationOptions
} from '../../src/services/proxy-manager';
import { ProxyManager } from '../../src/services/proxy-manager';
import type { ProxyConfiguration } from '../../src/types/proxy-configuration';

type SecretsStub = {
  get: (key: string) => Promise<string | undefined>;
  store: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

type MementoStub = {
  get: <T>(key: string) => T | undefined;
  update: (key: string, value: unknown) => Promise<void>;
};

type ProxyManagerParam = Parameters<typeof configureProxyCommand>[1];

describe('credential handling (security)', () => {
  it('never stores raw credentials in globalState', async () => {
    const globalState = createMemento();
    const secrets = createSecretsStub();
    const keychain = new KeychainService(secrets);
    const httpConfiguration = createHttpConfigurationStub();

    const proxyManager = new ProxyManager(globalState, keychain, httpConfiguration);

    await proxyManager.saveConfiguration({
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost'
      },
      credentials: {
        username: 'alice',
        password: 'super-secret'
      }
    });

    const savedConfig = globalState.get<ProxyConfiguration>('proxyToggler.savedProxy');
    assert.ok(savedConfig);
    assert.equal((savedConfig as unknown as { username?: unknown }).username, undefined);
    assert.equal((savedConfig as unknown as { password?: unknown }).password, undefined);

    const serializedState = JSON.stringify(Array.from(globalState.snapshot.entries()));
    assert.doesNotMatch(serializedState, /alice/);
    assert.doesNotMatch(serializedState, /super-secret/);
  });

  it('indicates credential presence without returning values', async () => {
    const globalState = createMemento();
    const secrets = createSecretsStub();
    const keychain = new KeychainService(secrets);
    const httpConfiguration = createHttpConfigurationStub();
    const proxyManager = new ProxyManager(globalState, keychain, httpConfiguration);

    await proxyManager.saveConfiguration({
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost'
      },
      credentials: {
        username: 'alice',
        password: 'super-secret'
      }
    });

    const loaded = await proxyManager.loadConfiguration();
    assert.ok(loaded);
    assert.equal(loaded.hasStoredCredentials, true);
    assert.equal((loaded as unknown as { username?: unknown }).username, undefined);
    assert.equal((loaded as unknown as { password?: unknown }).password, undefined);
  });

  it('preserves credentials across restart without requiring re-entry', async () => {
    const stateStore = new Map<string, unknown>();
    const secretStore = new Map<string, string>();

    const firstContext = {
      globalState: createMemento(stateStore),
      secrets: createSecretsStub(secretStore)
    };

    const firstProxyManager = new ProxyManager(
      firstContext.globalState,
      new KeychainService(firstContext.secrets),
      createHttpConfigurationStub()
    );

    await firstProxyManager.saveConfiguration({
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost'
      },
      credentials: {
        username: 'alice',
        password: 'super-secret'
      }
    });

    const secondContext = {
      globalState: createMemento(stateStore),
      secrets: createSecretsStub(secretStore)
    };

    const secondProxyManager = new ProxyManager(
      secondContext.globalState,
      new KeychainService(secondContext.secrets),
      createHttpConfigurationStub()
    );

    const loadedAfterRestart = await secondProxyManager.loadConfiguration();
    assert.ok(loadedAfterRestart);
    assert.equal(loadedAfterRestart.hasStoredCredentials, true);
  });

  it('never echoes credentials in user-facing messages', async () => {
    const providedUsername = 'alice';
    const providedPassword = 'super-secret';

    const capturedMessages: string[] = [];
    const proxyManager = createProxyManagerStub();

    const vscodeApi = createVscodeApiStub({
      inputs: ['http://proxy.example.com:8080', providedUsername, providedPassword, ''],
      onQuickPick: (items) => items.find((item) => item.value === true) ?? items[0]
    });

    const notificationService = {
      showSuccess: async (message: string): Promise<string | undefined> => {
        capturedMessages.push(message);
        return undefined;
      },
      showWarning: async (message: string): Promise<string | undefined> => {
        capturedMessages.push(message);
        return undefined;
      },
      showError: async (message: string): Promise<string | undefined> => {
        capturedMessages.push(message);
        return undefined;
      }
    };

    await configureProxyCommand(
      vscodeApi,
      proxyManager as unknown as ProxyManagerParam,
      notificationService,
      async (): Promise<void> => undefined
    );

    assert.ok(capturedMessages.length > 0);
    const serialized = capturedMessages.join('\n');
    assert.doesNotMatch(serialized, new RegExp(providedUsername, 'i'));
    assert.doesNotMatch(serialized, new RegExp(providedPassword, 'i'));
  });
});

function createMemento(
  store?: Map<string, unknown>
): MementoStub & { snapshot: Map<string, unknown> } {
  const snapshot = store ?? new Map<string, unknown>();

  return {
    snapshot,
    get: <T>(key: string): T | undefined => snapshot.get(key) as T | undefined,
    update: async (key: string, value: unknown): Promise<void> => {
      snapshot.set(key, value);
    }
  };
}

function createSecretsStub(initialStore?: Map<string, string>): SecretsStub {
  const store = initialStore ?? new Map<string, string>();

  return {
    get: async (key: string): Promise<string | undefined> => store.get(key),
    store: async (key: string, value: string): Promise<void> => {
      store.set(key, value);
    },
    delete: async (key: string): Promise<void> => {
      store.delete(key);
    }
  };
}

function createHttpConfigurationStub(): {
  update: (
    key: 'proxy' | 'proxyStrictSSL' | 'noProxy',
    value: string | boolean | undefined
  ) => Promise<void>;
} {
  return {
    update: async (): Promise<void> => undefined
  };
}

function createProxyManagerStub(): {
  loadConfiguration: () => Promise<LoadedProxyConfiguration | undefined>;
  saveConfiguration: (options: SaveConfigurationOptions) => Promise<void>;
} {
  return {
    loadConfiguration: async (): Promise<LoadedProxyConfiguration | undefined> => undefined,
    saveConfiguration: async (): Promise<void> => undefined
  };
}

function createVscodeApiStub(options: {
  inputs: string[];
  onQuickPick: (
    items: Array<{ label: string; value?: boolean }>
  ) => { label: string; value?: boolean } | undefined;
}): Parameters<typeof configureProxyCommand>[0] {
  let inputIndex = 0;

  return {
    l10n: {
      t: (message: string): string => message
    },
    window: {
      showInputBox: async (): Promise<string | undefined> => options.inputs[inputIndex++],
      showQuickPick: async <T extends { label: string }>(
        items: readonly T[]
      ): Promise<T | undefined> =>
        options.onQuickPick(items as unknown as Array<{ label: string; value?: boolean }>) as
          T | undefined
    },
    commands: {
      executeCommand: async (): Promise<unknown> => undefined
    }
  };
}
