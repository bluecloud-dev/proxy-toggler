import { strict as assert } from 'node:assert';

import type { ProxyCredentials } from '../../src/core/proxy-configuration';
import { ProxyManager } from '../../src/core/proxy-manager';
import { ConfigurationError } from '../../src/core/proxy-settings-writer';
import { ValidationError } from '../../src/core/validation';
import { createHttpSettings, createMemento, createProfilesSetting } from '../support/fakes';

const CONFIGURATION = {
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  noProxy: 'localhost'
};

// User settings that differ from CONFIGURATION, so a test can tell a restore from a clear.
const PREVIOUS_SETTINGS = {
  proxy: 'http://old.example.com:3128',
  proxyStrictSSL: false,
  noProxy: ['old.internal']
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

function readNames(entries: unknown): string[] {
  return (entries as Array<{ name: string }>).map((entry) => entry.name);
}

// The profile that saving CONFIGURATION adds when no profile exists.
const SAVED_PROFILE = {
  name: 'proxy.example.com',
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  bypassList: ['localhost']
};

const WORK = {
  name: 'Work',
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  bypassList: ['localhost']
};

const HOME = {
  name: 'Home',
  proxyUrl: 'http://home.example:3128',
  strictSSL: false,
  bypassList: []
};

function setup(
  options: {
    hasCredentials?: boolean;
    http?: Parameters<typeof createHttpSettings>[0];
    profiles?: unknown;
    record?: unknown;
  } = {}
) {
  const globalState = createMemento(
    new Map(options.record === undefined ? [] : [['proxyToggler.state', options.record]])
  );
  const keychain = createKeychainStub(options.hasCredentials);
  const httpSettings = createHttpSettings(options.http);
  const profilesSetting = createProfilesSetting(options.profiles);
  const proxyManager = new ProxyManager(globalState, keychain, httpSettings, profilesSetting);
  return { globalState, keychain, httpSettings, profilesSetting, proxyManager };
}

describe('ProxyManager', () => {
  describe('with profiles', () => {
    it('is configured once a profile exists, with a current profile', () => {
      const { proxyManager } = setup({ profiles: [WORK] });

      assert.deepEqual(proxyManager.getState(), {
        isEnabled: false,
        hasConfiguration: true,
        currentProfile: WORK
      });
    });

    it('is not configured without profiles and refuses to turn on', async () => {
      const { proxyManager } = setup({ profiles: [] });

      assert.deepEqual(proxyManager.getState(), { isEnabled: false, hasConfiguration: false });
      await assert.rejects(() => proxyManager.toggleProxy(), /No proxy configuration found/);
    });

    it('never makes a hidden entry current', () => {
      const hidden = { name: 'Aardvark', proxyUrl: 'not a url' };
      const { proxyManager } = setup({ profiles: [hidden, WORK] });

      assert.deepEqual(proxyManager.getState().currentProfile, WORK);
      assert.deepEqual(
        proxyManager.getHiddenProfiles().map(({ label }) => label),
        ['"Aardvark"']
      );
    });

    it('keeps the current profile across a reload', () => {
      const record = { isEnabled: false, currentProfile: WORK };
      const { proxyManager } = setup({ profiles: [HOME, WORK], record });

      assert.deepEqual(proxyManager.getState().currentProfile, WORK);
    });

    it('turns the current profile on, writing its values, and remembers it', async () => {
      const { globalState, httpSettings, proxyManager } = setup({ profiles: [HOME, WORK] });

      await proxyManager.enableProxy();

      assert.deepEqual(httpSettings.current, {
        proxy: HOME.proxyUrl,
        proxyStrictSSL: HOME.strictSSL,
        noProxy: HOME.bypassList
      });
      assert.deepEqual(globalState.store.get('proxyToggler.state'), {
        isEnabled: true,
        hasConfiguration: true,
        currentProfile: HOME
      });
    });

    it('turns off by clearing the settings, keeping the current profile', async () => {
      const record = { isEnabled: true, currentProfile: WORK };
      const { httpSettings, proxyManager } = setup({
        profiles: [HOME, WORK],
        record,
        http: { current: { proxy: WORK.proxyUrl, proxyStrictSSL: true, noProxy: ['localhost'] } }
      });

      assert.equal(await proxyManager.toggleProxy(), false);

      assert.deepEqual(httpSettings.current, {
        proxy: undefined,
        proxyStrictSSL: undefined,
        noProxy: undefined
      });
      assert.deepEqual(proxyManager.getState().currentProfile, WORK);
    });

    it('computes a fallback current profile without ever saving it', async () => {
      const gone = { ...WORK, name: 'Gone', proxyUrl: 'http://gone.example:8080' };
      const { globalState, proxyManager } = setup({
        profiles: [WORK, HOME],
        record: { isEnabled: true, currentProfile: gone }
      });

      const fallback = proxyManager.getState().currentProfile;
      await proxyManager.disableProxy();

      assert.deepEqual(fallback, HOME);
      assert.deepEqual(globalState.store.get('proxyToggler.state'), {
        isEnabled: false,
        hasConfiguration: true,
        currentProfile: gone
      });
    });

    it('saves the first configuration as a profile named after its host, and makes it current', async () => {
      const { globalState, profilesSetting, proxyManager } = setup({ profiles: [] });

      await proxyManager.saveConfiguration(
        { proxyUrl: 'http://proxy.example.com:8080', strictSSL: true, noProxy: 'localhost' },
        { mode: 'keep' }
      );

      const saved = {
        name: 'proxy.example.com',
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        bypassList: ['localhost']
      };
      assert.deepEqual(profilesSetting.value, [saved]);
      assert.deepEqual(proxyManager.getState().currentProfile, saved);
      // 0.1.x keeps its own configuration, so a downgrade still finds it (ADR 0001).
      assert.equal(globalState.store.has('proxyToggler.savedProxy'), false);
    });

    it('names the first saved profile so that it clashes with no entry', async () => {
      const unusable = { name: 'proxy.example.com' };
      const { profilesSetting, proxyManager } = setup({ profiles: [unusable] });

      await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

      assert.deepEqual(readNames(profilesSetting.value), [
        'proxy.example.com',
        'proxy.example.com (2)'
      ]);
    });

    it('saves into the current profile, keeping other entries and unknown fields', async () => {
      const { profilesSetting, proxyManager } = setup({
        profiles: ['not a profile', { ...WORK, color: 'blue' }, HOME],
        record: { isEnabled: false, currentProfile: WORK }
      });

      await proxyManager.saveConfiguration(
        { proxyUrl: 'http://new.example.com:3128', strictSSL: false, noProxy: '.corp' },
        { mode: 'keep' }
      );

      assert.deepEqual(profilesSetting.value, [
        'not a profile',
        {
          name: 'Work',
          proxyUrl: 'http://new.example.com:3128',
          strictSSL: false,
          bypassList: ['.corp'],
          color: 'blue'
        },
        HOME
      ]);
    });

    it('loads the current profile for editing, with credential presence', async () => {
      const { proxyManager } = setup({ profiles: [WORK], hasCredentials: true });

      assert.deepEqual(await proxyManager.loadConfiguration(), {
        proxyUrl: WORK.proxyUrl,
        strictSSL: WORK.strictSSL,
        noProxy: 'localhost',
        hasStoredCredentials: true
      });
    });
  });

  describe('migrating the 0.1.x configuration', () => {
    const SAVED_PROXY = {
      proxyUrl: 'http://proxy.example.com:8080',
      strictSSL: false,
      noProxy: 'localhost,.corp'
    };
    const MIGRATED = {
      name: 'proxy.example.com',
      proxyUrl: 'http://proxy.example.com:8080',
      strictSSL: false,
      bypassList: ['localhost', '.corp']
    };

    function setupMigration(options: Parameters<typeof setup>[0] = {}) {
      const context = setup(options);
      context.globalState.store.set('proxyToggler.savedProxy', SAVED_PROXY);
      return context;
    }

    it('copies it into a profile named after its host and makes that current, without turning it on', async () => {
      const { globalState, httpSettings, profilesSetting, proxyManager } = setupMigration({
        record: { isEnabled: true, hasConfiguration: true }
      });

      await proxyManager.migrateSavedProxy();

      assert.deepEqual(profilesSetting.value, [MIGRATED]);
      assert.deepEqual(globalState.store.get('proxyToggler.state'), {
        isEnabled: true,
        hasConfiguration: true,
        currentProfile: MIGRATED
      });
      assert.deepEqual(globalState.store.get('proxyToggler.savedProxy'), SAVED_PROXY);
      assert.deepEqual(httpSettings.updates, []);
    });

    it('makes a profile with the same values current instead of adding one', async () => {
      const lab = { ...MIGRATED, name: 'Lab', bypassList: ['.CORP', 'localhost'] };
      const { profilesSetting, proxyManager } = setupMigration({ profiles: [WORK, lab] });

      await proxyManager.migrateSavedProxy();

      assert.deepEqual(profilesSetting.writes, []);
      assert.deepEqual(proxyManager.getState().currentProfile, lab);
    });

    it('records the copy once a later read shows it, and then never brings back a deleted profile', async () => {
      const { globalState, profilesSetting, proxyManager } = setupMigration({ profiles: [] });

      await proxyManager.migrateSavedProxy();
      const markerAfterCopy = globalState.store.get('proxyToggler.migratedProxy');
      await proxyManager.migrateSavedProxy();
      const marker = globalState.store.get('proxyToggler.migratedProxy');
      profilesSetting.value = [];
      await proxyManager.migrateSavedProxy();

      assert.equal(markerAfterCopy, undefined);
      assert.deepEqual(marker, {
        proxyUrl: MIGRATED.proxyUrl,
        strictSSL: MIGRATED.strictSSL,
        bypassList: MIGRATED.bypassList
      });
      assert.deepEqual(profilesSetting.value, []);
    });

    it('copies the new values when the 0.1.x configuration changes later', async () => {
      const { globalState, profilesSetting, proxyManager } = setupMigration({ profiles: [] });
      await proxyManager.migrateSavedProxy();
      await proxyManager.migrateSavedProxy();

      // A downgrade, or a 0.1.x window still open, saved other values.
      globalState.store.set('proxyToggler.savedProxy', {
        ...SAVED_PROXY,
        proxyUrl: 'http://other.example.com:3128'
      });
      await proxyManager.migrateSavedProxy();

      assert.deepEqual(readNames(profilesSetting.value), [
        'proxy.example.com',
        'other.example.com'
      ]);
    });

    it('keeps the current profile a VS Code Profile already has', async () => {
      const { proxyManager } = setupMigration({
        profiles: [WORK],
        record: { isEnabled: false, currentProfile: WORK }
      });

      await proxyManager.migrateSavedProxy();

      assert.deepEqual(proxyManager.getState().currentProfile, WORK);
    });

    it('adds the copy again when a write from another VS Code Profile lost it', async () => {
      const { globalState, profilesSetting, proxyManager } = setupMigration({ profiles: [] });

      await proxyManager.migrateSavedProxy();
      // Another VS Code Profile migrated at the same time, from the list as it was before.
      profilesSetting.value = [HOME];
      await proxyManager.migrateSavedProxy();

      assert.deepEqual(profilesSetting.value, [HOME, MIGRATED]);
      assert.equal(globalState.store.get('proxyToggler.migratedProxy'), undefined);
    });

    it('names the copy so that it clashes with no entry', async () => {
      const elsewhere = { name: 'PROXY.example.com', proxyUrl: 'http://elsewhere.example:1' };
      const { profilesSetting, proxyManager } = setupMigration({ profiles: [elsewhere] });

      await proxyManager.migrateSavedProxy();

      assert.deepEqual(readNames(profilesSetting.value), [
        'PROXY.example.com',
        'proxy.example.com (2)'
      ]);
    });

    it('skips a 0.1.x configuration it cannot use', async () => {
      const { globalState, profilesSetting, proxyManager } = setup({ profiles: [] });
      globalState.store.set('proxyToggler.savedProxy', { ...SAVED_PROXY, proxyUrl: 'nonsense' });

      await proxyManager.migrateSavedProxy();

      assert.deepEqual(profilesSetting.writes, []);
    });
  });

  it('saves a trimmed configuration with the default bypass list and stores credentials', async () => {
    const { globalState, keychain, profilesSetting, proxyManager } = setup();

    await proxyManager.saveConfiguration(
      { proxyUrl: ' http://proxy.example.com:8080 ', strictSSL: true, noProxy: '' },
      { mode: 'set', credentials: { username: 'alice', password: 'secret' } }
    );

    const saved = { ...SAVED_PROFILE, bypassList: ['localhost', '127.0.0.1'] };
    assert.deepEqual(profilesSetting.value, [saved]);
    assert.deepEqual(globalState.store.get('proxyToggler.state'), {
      isEnabled: false,
      hasConfiguration: true,
      currentProfile: saved
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

  it('loads the saved configuration with credential presence but never the credentials', async () => {
    const { proxyManager } = setup({ hasCredentials: true });
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    assert.deepEqual(await proxyManager.loadConfiguration(), {
      ...CONFIGURATION,
      hasStoredCredentials: true
    });
  });

  it('is configured once a configuration is saved', async () => {
    const { proxyManager } = setup();
    assert.deepEqual(proxyManager.getState(), { isEnabled: false, hasConfiguration: false });

    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    assert.deepEqual(proxyManager.getState(), {
      isEnabled: false,
      hasConfiguration: true,
      currentProfile: SAVED_PROFILE
    });
    assert.equal(proxyManager.hasConfiguration(), true);
  });

  it('validates before persisting anything', async () => {
    const { globalState, profilesSetting, proxyManager } = setup();

    await assert.rejects(
      () =>
        proxyManager.saveConfiguration(
          { ...CONFIGURATION, proxyUrl: 'proxy.example.com:8080' },
          { mode: 'keep' }
        ),
      ValidationError
    );
    assert.deepEqual(globalState.updates, []);
    assert.deepEqual(profilesSetting.writes, []);
  });

  it('enables by writing the http settings in order, then the state', async () => {
    const { httpSettings, proxyManager } = setup();
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    await proxyManager.enableProxy();

    assert.deepEqual(httpSettings.updates, [
      { key: 'proxy', value: 'http://proxy.example.com:8080' },
      { key: 'proxyStrictSSL', value: true },
      { key: 'noProxy', value: ['localhost'] }
    ]);
    assert.deepEqual(proxyManager.getState(), {
      isEnabled: true,
      hasConfiguration: true,
      currentProfile: SAVED_PROFILE
    });
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

  it('restores the settings it already wrote when a later write fails', async () => {
    const { httpSettings, proxyManager } = setup({
      http: { failKey: 'noProxy', current: PREVIOUS_SETTINGS }
    });
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    await assert.rejects(() => proxyManager.enableProxy(), ConfigurationError);

    assert.deepEqual(httpSettings.current, PREVIOUS_SETTINGS);
    assert.equal(proxyManager.getState().isEnabled, false);
  });

  it('keeps restoring after a restore fails and names the settings it could not restore', async () => {
    const { httpSettings, proxyManager } = setup({
      http: {
        current: PREVIOUS_SETTINGS,
        // http.noProxy cannot be written, and writing the earlier http.proxy back fails too.
        failWhen: ({ key, value }) =>
          key === 'noProxy' || (key === 'proxy' && value === PREVIOUS_SETTINGS.proxy)
      }
    });
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    await assert.rejects(
      () => proxyManager.enableProxy(),
      (error: unknown) => {
        assert.ok(error instanceof ConfigurationError);
        assert.equal(error.key, 'noProxy');
        assert.match(String(error.cause), /Failed to update noProxy/);
        assert.match(error.toUserMessage(), /"http\.proxy"/);
        assert.doesNotMatch(error.toUserMessage(), /"http\.proxyStrictSSL"/);
        assert.deepEqual([...error.restoreErrors.keys()], ['proxy']);
        assert.match(String(error.restoreErrors.get('proxy')), /Failed to update proxy/);
        return true;
      }
    );
    assert.equal(httpSettings.current.proxy, CONFIGURATION.proxyUrl);
    assert.equal(httpSettings.current.proxyStrictSSL, PREVIOUS_SETTINGS.proxyStrictSSL);
  });

  it('restores unset settings as unset, not as the defaults VS Code reports for them', async () => {
    const { httpSettings, proxyManager } = setup({
      http: { failKey: 'noProxy', defaults: { proxyStrictSSL: true } }
    });
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    await assert.rejects(() => proxyManager.enableProxy(), ConfigurationError);

    assert.deepEqual(httpSettings.current, {
      proxy: undefined,
      proxyStrictSSL: undefined,
      noProxy: undefined
    });
  });

  it('finishes rolling back a failed enable before a disable queued behind it starts', async () => {
    const { httpSettings, proxyManager } = setup({
      http: {
        current: PREVIOUS_SETTINGS,
        // Only enable's write of http.noProxy fails; disable's clearing write succeeds.
        failWhen: ({ key, value }) => key === 'noProxy' && value !== undefined
      }
    });
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    const [enable, disable] = await Promise.allSettled([
      proxyManager.enableProxy(),
      proxyManager.disableProxy()
    ]);

    assert.equal(enable.status, 'rejected');
    assert.equal(disable.status, 'fulfilled');
    assert.deepEqual(httpSettings.current, {
      proxy: undefined,
      proxyStrictSSL: undefined,
      noProxy: undefined
    });
  });

  it('leaves the proxy cleared when a later write fails during disable', async () => {
    const { httpSettings, proxyManager } = setup({
      http: { failKey: 'proxyStrictSSL', current: PREVIOUS_SETTINGS }
    });

    await assert.rejects(
      () => proxyManager.disableProxy(),
      (error: unknown) => {
        assert.ok(error instanceof ConfigurationError);
        assert.equal(error.operation, 'disable');
        assert.equal(error.key, 'proxyStrictSSL');
        return true;
      }
    );
    assert.deepEqual(httpSettings.current, {
      proxy: undefined,
      proxyStrictSSL: false,
      noProxy: ['old.internal']
    });
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

  it('runs overlapping state changes one at a time, in call order', async () => {
    const { httpSettings, proxyManager } = setup();
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    const results = await Promise.all([proxyManager.toggleProxy(), proxyManager.toggleProxy()]);

    assert.deepEqual(results, [true, false]);
    assert.deepEqual(
      httpSettings.updates.map((update) => update.key),
      ['proxy', 'proxyStrictSSL', 'noProxy', 'proxy', 'proxyStrictSSL', 'noProxy']
    );
    assert.equal(proxyManager.getState().isEnabled, false);
  });

  it('finishes each kind of change before the next starts, even when the first is slow', async () => {
    const slowKeychain = {
      ...createKeychainStub(),
      storeCredentials: async (): Promise<void> => {
        await new Promise((resolve) => setImmediate(resolve));
      }
    };
    const proxyManager = new ProxyManager(
      createMemento(),
      slowKeychain,
      createHttpSettings(),
      createProfilesSetting()
    );
    const finished: string[] = [];
    const record = (name: string) => (): void => {
      finished.push(name);
    };

    await Promise.all([
      proxyManager
        .saveConfiguration(CONFIGURATION, {
          mode: 'set',
          credentials: { username: 'alice', password: 'secret' }
        })
        .then(record('save')),
      proxyManager.syncToggleState().then(record('sync')),
      proxyManager.enableProxy().then(record('enable')),
      proxyManager.disableProxy().then(record('disable'))
    ]);

    assert.deepEqual(finished, ['save', 'sync', 'enable', 'disable']);
  });

  it('runs a queued state change after the one before it fails', async () => {
    const { proxyManager } = setup({ http: { failKey: 'noProxy' } });
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });
    const otherConfiguration = { ...CONFIGURATION, proxyUrl: 'http://other.example.com:3128' };

    const [enable, save] = await Promise.allSettled([
      proxyManager.enableProxy(),
      proxyManager.saveConfiguration(otherConfiguration, { mode: 'keep' })
    ]);

    assert.equal(enable.status, 'rejected');
    assert.equal(save.status, 'fulfilled');
    assert.equal(proxyManager.getState().currentProfile?.proxyUrl, otherConfiguration.proxyUrl);
  });

  it('records that the settings are applied, without touching them or the configuration', async () => {
    const { httpSettings, profilesSetting, proxyManager } = setup({
      http: {
        current: { proxy: CONFIGURATION.proxyUrl, proxyStrictSSL: true, noProxy: ['localhost'] }
      }
    });
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });

    const profileWrites = profilesSetting.writes.length;

    await proxyManager.syncToggleState();

    assert.equal(proxyManager.getState().isEnabled, true);
    assert.deepEqual(httpSettings.updates, []);
    assert.equal(profilesSetting.writes.length, profileWrites);
  });

  it('does not rewrite the state when it already matches the settings', async () => {
    const { globalState, proxyManager } = setup();
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });
    const writesBeforeSync = globalState.updates.length;

    await proxyManager.syncToggleState();

    assert.equal(globalState.updates.length, writesBeforeSync);
  });

  it('keeps state fields it does not manage, such as ones written by another version', async () => {
    const { globalState, proxyManager } = setup();
    await proxyManager.saveConfiguration(CONFIGURATION, { mode: 'keep' });
    globalState.store.set('proxyToggler.state', {
      isEnabled: true,
      hasConfiguration: false,
      lastProfile: 'work'
    });

    await proxyManager.syncToggleState();

    assert.deepEqual(globalState.store.get('proxyToggler.state'), {
      isEnabled: false,
      hasConfiguration: true,
      lastProfile: 'work'
    });
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

    it('matches a reordered bypass list and a proxy URL with credentials', async () => {
      const { proxyManager } = setup({
        http: {
          current: {
            proxy: 'http://alice:secret@proxy.example.com:8080',
            proxyStrictSSL: true,
            noProxy: ['b.internal', 'localhost']
          }
        }
      });
      await proxyManager.saveConfiguration(
        { ...CONFIGURATION, noProxy: 'localhost,b.internal' },
        { mode: 'keep' }
      );

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
