import { strict as assert } from 'node:assert';

import type { ProxyCredentials } from '../../src/core/proxy-configuration';
import { ConfigurationError, ProxyManager } from '../../src/core/proxy-manager';
import { ValidationError } from '../../src/core/validation';
import { createHttpSettings, createMemento } from '../support/fakes';

const CONFIGURATION = {
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  noProxy: 'localhost'
};

function createKeychainStub(hasCredentials = false) {
  const calls = { store: [] as ProxyCredentials[], clear: 0 };
  return {
    calls,
    storeCredentials: async (username = '', password = ''): Promise<void> => {
      calls.store.push({ username, password });
    },
    clearCredentials: async (): Promise<void> => {
      calls.clear += 1;
    },
    hasCredentials: async (): Promise<boolean> => hasCredentials
  };
}

function setup(
  options: { hasCredentials?: boolean; http?: Parameters<typeof createHttpSettings>[0] } = {}
) {
  const globalState = createMemento();
  const keychain = createKeychainStub(options.hasCredentials);
  const httpSettings = createHttpSettings(options.http);
  const proxyManager = new ProxyManager(globalState, keychain, httpSettings);
  return { globalState, keychain, httpSettings, proxyManager };
}

describe('ProxyManager', () => {
  it('persists a trimmed configuration with the default bypass list and stores credentials', async () => {
    const { globalState, keychain, proxyManager } = setup();

    await proxyManager.saveConfiguration(
      { proxyUrl: ' http://proxy.example.com:8080 ', strictSSL: true, noProxy: '' },
      { mode: 'set', credentials: { username: 'alice', password: 'secret' } }
    );

    assert.deepEqual(globalState.store.get('proxyToggler.savedProxy'), {
      proxyUrl: 'http://proxy.example.com:8080',
      strictSSL: true,
      noProxy: 'localhost,127.0.0.1'
    });
    assert.deepEqual(globalState.store.get('proxyToggler.state'), {
      isEnabled: false,
      hasConfiguration: true
    });
    assert.deepEqual(keychain.calls, {
      store: [{ username: 'alice', password: 'secret' }],
      clear: 0
    });
  });

  it('leaves stored credentials alone when a save omits them', async () => {
    const { keychain, proxyManager } = setup();

    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    assert.deepEqual(keychain.calls, { store: [], clear: 0 });
  });

  it('clears stored credentials on request', async () => {
    const { keychain, proxyManager } = setup();

    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'clear' });

    assert.deepEqual(keychain.calls, { store: [], clear: 1 });
  });

  it('loads the configuration with credential presence but never the credentials', async () => {
    const { proxyManager } = setup({ hasCredentials: true });
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    assert.deepEqual(await proxyManager.loadConfiguration(), {
      ...CONFIGURATION,
      hasStoredCredentials: true
    });
  });

  it('derives hasConfiguration from the saved configuration', async () => {
    const { proxyManager } = setup();
    assert.deepEqual(proxyManager.getState(), { isEnabled: false, hasConfiguration: false });

    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    assert.deepEqual(proxyManager.getState(), { isEnabled: false, hasConfiguration: true });
    assert.equal(proxyManager.hasConfiguration(), true);
  });

  it('validates before persisting anything', async () => {
    const { globalState, proxyManager } = setup();

    await assert.rejects(
      () =>
        proxyManager.saveConfiguration(
          { ...CONFIGURATION, proxyUrl: 'proxy.example.com:8080' },
          { mode: 'keep' }
        ),
      ValidationError
    );
    assert.deepEqual(globalState.updates, []);
  });

  it('enables by writing the http settings in order, then the state', async () => {
    const { httpSettings, proxyManager } = setup();
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    await proxyManager.enableProxy();

    assert.deepEqual(httpSettings.updates, [
      { key: 'proxy', value: 'http://proxy.example.com:8080' },
      { key: 'proxyStrictSSL', value: true },
      { key: 'noProxy', value: 'localhost' }
    ]);
    assert.deepEqual(proxyManager.getState(), { isEnabled: true, hasConfiguration: true });
  });

  it('reports which setting failed as a ConfigurationError', async () => {
    const { proxyManager } = setup({ http: { failKey: 'noProxy' } });
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    await assert.rejects(
      () => proxyManager.enableProxy(),
      (error: unknown) => {
        assert.ok(error instanceof ConfigurationError);
        assert.equal(error.operation, 'enable');
        assert.equal(error.key, 'noProxy');
        assert.equal(error.getSettingId(), 'http.noProxy');
        assert.match(error.toUserMessage(), /http\.noProxy/);
        assert.match(String(error.cause), /Failed to update noProxy/);
        return true;
      }
    );
  });

  it('disables by clearing the http settings, then the state', async () => {
    const { httpSettings, proxyManager } = setup();

    await proxyManager.disableProxy();

    assert.deepEqual(httpSettings.updates, [
      { key: 'proxy', value: undefined },
      { key: 'proxyStrictSSL', value: undefined },
      { key: 'noProxy', value: undefined }
    ]);
    assert.deepEqual(proxyManager.getState(), { isEnabled: false, hasConfiguration: false });
  });

  it('toggles between enabled and disabled', async () => {
    const { proxyManager } = setup();
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    assert.equal(await proxyManager.toggleProxy(), true);
    assert.equal(proxyManager.getState().isEnabled, true);
    assert.equal(await proxyManager.toggleProxy(), false);
    assert.equal(proxyManager.getState().isEnabled, false);
  });

  it('refuses to toggle without a saved configuration', async () => {
    const { proxyManager } = setup();

    await assert.rejects(() => proxyManager.toggleProxy(), /No proxy configuration found/);
  });

  it('records a synced state without touching the settings or the configuration', async () => {
    const { globalState, httpSettings, proxyManager } = setup();
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    await proxyManager.syncToggleState(true);

    assert.deepEqual(proxyManager.getState(), { isEnabled: true, hasConfiguration: true });
    assert.deepEqual(httpSettings.updates, []);
    assert.deepEqual(globalState.store.get('proxyToggler.savedProxy'), CONFIGURATION);
  });

  describe('isConfigurationApplied', () => {
    it('is false when nothing is saved', () => {
      assert.equal(setup().proxyManager.isConfigurationApplied(), false);
    });

    it('compares the bypass list entry by entry, whatever its shape', async () => {
      const { proxyManager } = setup({
        http: {
          current: {
            proxy: CONFIGURATION.proxyUrl,
            proxyStrictSSL: true,
            noProxy: [' localhost ']
          }
        }
      });
      await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

      assert.equal(proxyManager.isConfigurationApplied(), true);
    });

    it('is false when any applied value differs', async () => {
      const { proxyManager } = setup({
        http: { current: { proxy: CONFIGURATION.proxyUrl, proxyStrictSSL: false, noProxy: [] } }
      });
      await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

      assert.equal(proxyManager.isConfigurationApplied(), false);
    });
  });
});
