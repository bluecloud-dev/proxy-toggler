import { strict as assert } from 'node:assert';

import type { ProxyConfiguration, ProxyCredentials } from '../../src/types/proxy-configuration';
import type { ToggleState } from '../../src/types/toggle-state';
import type { KeychainService } from '../../src/services/keychain-service';
import type { HttpConfiguration } from '../../src/services/proxy-manager';
import { ConfigurationError, ProxyManager } from '../../src/services/proxy-manager';
import { ValidationError } from '../../src/services/validation-service';

type MementoStub = {
  get: <T>(key: string) => T | undefined;
  update: (key: string, value: unknown) => Promise<void>;
};

describe('ProxyManager', () => {
  it('saves non-sensitive config, stores credentials, and updates state', async () => {
    const globalState = createMemento();
    const keychain = createKeychainStub();
    const httpConfiguration = createHttpConfigurationStub();
    const proxyManager = new ProxyManager(globalState, keychain, httpConfiguration);

    const configuration: ProxyConfiguration = {
      proxyUrl: ' http://proxy.example.com:8080 ',
      strictSSL: true,
      noProxy: ''
    };

    const credentials: ProxyCredentials = {
      username: 'alice',
      password: 'secret'
    };

    await proxyManager.saveConfiguration({ configuration, credentials });

    const savedConfig = globalState.get<ProxyConfiguration>('proxyToggler.savedProxy');
    assert.deepEqual(savedConfig, {
      proxyUrl: 'http://proxy.example.com:8080',
      strictSSL: true,
      noProxy: 'localhost,127.0.0.1'
    });

    assert.deepEqual(keychain.storeCalls, [{ username: 'alice', password: 'secret' }]);
    assert.equal(keychain.clearCalls, 0);

    const state = globalState.get<ToggleState>('proxyToggler.state');
    assert.deepEqual(state, { isEnabled: false, hasConfiguration: true });
  });

  it('preserves existing credentials when saveConfiguration omits credential updates', async () => {
    const globalState = createMemento();
    const keychain = createKeychainStub();
    const httpConfiguration = createHttpConfigurationStub();
    const proxyManager = new ProxyManager(globalState, keychain, httpConfiguration);

    await proxyManager.saveConfiguration({
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: false,
        noProxy: 'localhost'
      },
      credentials: { username: 'alice', password: 'secret' }
    });

    await proxyManager.saveConfiguration({
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost'
      }
    });

    assert.equal(keychain.storeCalls.length, 1);
    assert.equal(keychain.clearCalls, 0);
  });

  it('can clear stored credentials when requested', async () => {
    const globalState = createMemento();
    const keychain = createKeychainStub();
    const httpConfiguration = createHttpConfigurationStub();
    const proxyManager = new ProxyManager(globalState, keychain, httpConfiguration);

    await proxyManager.saveConfiguration({
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost'
      },
      clearCredentials: true
    });

    assert.equal(keychain.storeCalls.length, 0);
    assert.equal(keychain.clearCalls, 1);
  });

  it('loads configuration without returning credentials', async () => {
    const globalState = createMemento();
    const keychain = createKeychainStub({ hasCredentials: true });
    const httpConfiguration = createHttpConfigurationStub();
    const proxyManager = new ProxyManager(globalState, keychain, httpConfiguration);

    await proxyManager.saveConfiguration({
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost'
      }
    });

    const loaded = await proxyManager.loadConfiguration();
    assert.deepEqual(loaded, {
      proxyUrl: 'http://proxy.example.com:8080',
      strictSSL: true,
      noProxy: 'localhost',
      hasStoredCredentials: true
    });
  });

  it('reports default state based on saved configuration presence', async () => {
    const globalState = createMemento();
    const keychain = createKeychainStub();
    const httpConfiguration = createHttpConfigurationStub();
    const proxyManager = new ProxyManager(globalState, keychain, httpConfiguration);

    assert.deepEqual(proxyManager.getState(), { isEnabled: false, hasConfiguration: false });

    await proxyManager.saveConfiguration({
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost'
      }
    });

    assert.deepEqual(proxyManager.getState(), { isEnabled: false, hasConfiguration: true });
    assert.equal(proxyManager.hasConfiguration(), true);
  });

  it('validates proxy URLs before persisting', async () => {
    const globalState = createMemento();
    const keychain = createKeychainStub();
    const httpConfiguration = createHttpConfigurationStub();
    const proxyManager = new ProxyManager(globalState, keychain, httpConfiguration);

    await assert.rejects(
      () =>
        proxyManager.saveConfiguration({
          configuration: {
            proxyUrl: 'proxy.example.com:8080',
            strictSSL: true,
            noProxy: 'localhost'
          }
        }),
      ValidationError
    );

    assert.equal(globalState.updateCalls.length, 0);
  });

  it('enables proxy by updating VS Code http settings and state', async () => {
    const globalState = createMemento();
    const keychain = createKeychainStub();
    const httpConfiguration = createHttpConfigurationStub();
    const proxyManager = new ProxyManager(globalState, keychain, httpConfiguration);

    await proxyManager.saveConfiguration({
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost'
      }
    });

    await proxyManager.enableProxy();

    assert.deepEqual(httpConfiguration.updateCalls, [
      { key: 'proxy', value: 'http://proxy.example.com:8080' },
      { key: 'proxyStrictSSL', value: true },
      { key: 'noProxy', value: 'localhost' }
    ]);

    assert.deepEqual(proxyManager.getState(), { isEnabled: true, hasConfiguration: true });
  });

  it('wraps VS Code config update failures in ConfigurationError', async () => {
    const globalState = createMemento();
    const keychain = createKeychainStub();
    const httpConfiguration = createHttpConfigurationStub({ failKey: 'noProxy' });
    const proxyManager = new ProxyManager(globalState, keychain, httpConfiguration);

    await proxyManager.saveConfiguration({
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost'
      }
    });

    await assert.rejects(
      () => proxyManager.enableProxy(),
      (error: unknown) => {
        assert.ok(error instanceof ConfigurationError);
        assert.equal(error.operation, 'enable');
        assert.equal(error.key, 'noProxy');
        assert.equal(error.getSettingId(), 'http.noProxy');
        assert.match(error.toUserMessage(), /http\.noProxy/);
        return true;
      }
    );
  });

  it('disables proxy by clearing VS Code http settings and state', async () => {
    const globalState = createMemento();
    const keychain = createKeychainStub();
    const httpConfiguration = createHttpConfigurationStub();
    const proxyManager = new ProxyManager(globalState, keychain, httpConfiguration);

    await proxyManager.disableProxy();

    assert.deepEqual(httpConfiguration.updateCalls, [
      { key: 'proxy', value: undefined },
      { key: 'proxyStrictSSL', value: undefined },
      { key: 'noProxy', value: undefined }
    ]);

    assert.deepEqual(proxyManager.getState(), { isEnabled: false, hasConfiguration: false });
  });

  it('toggles proxy enabled state when configured', async () => {
    const globalState = createMemento();
    const keychain = createKeychainStub();
    const httpConfiguration = createHttpConfigurationStub();
    const proxyManager = new ProxyManager(globalState, keychain, httpConfiguration);

    await proxyManager.saveConfiguration({
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost'
      }
    });

    assert.equal(await proxyManager.toggleProxy(), true);
    assert.deepEqual(proxyManager.getState(), { isEnabled: true, hasConfiguration: true });

    assert.equal(await proxyManager.toggleProxy(), false);
    assert.deepEqual(proxyManager.getState(), { isEnabled: false, hasConfiguration: true });
  });

  it('can sync enabled state without changing saved configuration', async () => {
    const globalState = createMemento();
    const keychain = createKeychainStub();
    const httpConfiguration = createHttpConfigurationStub();
    const proxyManager = new ProxyManager(globalState, keychain, httpConfiguration);

    await proxyManager.saveConfiguration({
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost'
      }
    });

    assert.deepEqual(proxyManager.getSavedConfiguration(), {
      proxyUrl: 'http://proxy.example.com:8080',
      strictSSL: true,
      noProxy: 'localhost'
    });

    await proxyManager.syncToggleState(true);
    assert.deepEqual(proxyManager.getState(), { isEnabled: true, hasConfiguration: true });
  });

  it('throws when toggling without a saved configuration', async () => {
    const globalState = createMemento();
    const keychain = createKeychainStub();
    const httpConfiguration = createHttpConfigurationStub();
    const proxyManager = new ProxyManager(globalState, keychain, httpConfiguration);

    await assert.rejects(() => proxyManager.toggleProxy(), Error);
  });
});

function createMemento(): MementoStub & { updateCalls: Array<{ key: string; value: unknown }> } {
  const store = new Map<string, unknown>();
  const updateCalls: Array<{ key: string; value: unknown }> = [];

  return {
    updateCalls,
    get: <T>(key: string): T | undefined => store.get(key) as T | undefined,
    update: async (key: string, value: unknown): Promise<void> => {
      updateCalls.push({ key, value });
      store.set(key, value);
    }
  };
}

function createKeychainStub(options?: { hasCredentials?: boolean }): KeychainService & {
  storeCalls: ProxyCredentials[];
  clearCalls: number;
} {
  const storeCalls: ProxyCredentials[] = [];
  let clearCalls = 0;

  return {
    storeCalls,
    get clearCalls(): number {
      return clearCalls;
    },
    storeCredentials: async (username?: string, password?: string): Promise<void> => {
      storeCalls.push({ username: username ?? '', password: password ?? '' });
    },
    retrieveCredentials: async (): Promise<ProxyCredentials | undefined> => undefined,
    clearCredentials: async (): Promise<void> => {
      clearCalls += 1;
    },
    hasCredentials: async (): Promise<boolean> => options?.hasCredentials ?? false
  } as unknown as KeychainService & { storeCalls: ProxyCredentials[]; clearCalls: number };
}

function createHttpConfigurationStub(options?: {
  failKey?: 'proxy' | 'proxyStrictSSL' | 'noProxy';
}): HttpConfiguration & {
  updateCalls: Array<{ key: string; value: string | boolean | undefined }>;
} {
  const updateCalls: Array<{ key: string; value: string | boolean | undefined }> = [];

  return {
    updateCalls,
    update: async (
      key: 'proxy' | 'proxyStrictSSL' | 'noProxy',
      value: string | boolean | undefined
    ): Promise<void> => {
      updateCalls.push({ key, value });
      if (options?.failKey === key) {
        throw new Error(`Failed to update ${key}`);
      }
    }
  };
}
