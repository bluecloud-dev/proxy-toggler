import { strict as assert } from 'node:assert';

import { ProxyManager } from '../../src/core/proxy-manager';
import { ConfigurationError } from '../../src/core/proxy-settings-writer';
import { ValidationError } from '../../src/core/validation';
import { createHttpSettings, createMemento, createProfilesSetting } from '../support/fakes';

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

const OFFICE = {
  name: 'Office',
  proxyUrl: 'http://office.example:3128',
  strictSSL: true,
  bypassList: []
};

// User settings that differ from WORK, so a test can tell a restore from a clear.
const PREVIOUS_SETTINGS = {
  proxy: 'http://old.example.com:3128',
  proxyStrictSSL: false,
  noProxy: ['old.internal']
};

const CLEARED = { proxy: undefined, proxyStrictSSL: undefined, noProxy: undefined };

function readNames(entries: unknown): string[] {
  return (entries as Array<{ name: string }>).map((entry) => entry.name);
}

function setup(
  options: {
    http?: Parameters<typeof createHttpSettings>[0];
    profiles?: unknown;
    record?: unknown;
  } = {}
) {
  const globalState = createMemento(
    new Map(options.record === undefined ? [] : [['proxyToggler.state', options.record]])
  );
  const httpSettings = createHttpSettings(options.http);
  const profilesSetting = createProfilesSetting(options.profiles);
  const proxyManager = new ProxyManager(globalState, httpSettings, profilesSetting);
  return { globalState, httpSettings, profilesSetting, proxyManager };
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

      assert.deepEqual(httpSettings.current, CLEARED);
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

    it('switches to a named profile, turning it on and making it current', async () => {
      const { httpSettings, proxyManager } = setup({
        profiles: [WORK, HOME],
        record: { isEnabled: false, currentProfile: WORK }
      });

      const switched = await proxyManager.switchTo('home');

      assert.deepEqual(switched, HOME);
      assert.equal(httpSettings.current.proxy, HOME.proxyUrl);
      assert.deepEqual(proxyManager.getState().currentProfile, HOME);
      assert.equal(await proxyManager.switchTo('Office'), undefined);
    });
  });

  describe('adding a profile', () => {
    it('adds it at the end, keeping every other entry and unknown field', async () => {
      const others = ['not a profile', { ...WORK, color: 'blue' }];
      const { profilesSetting, proxyManager } = setup({ profiles: others });

      await proxyManager.addProfile(OFFICE);

      assert.deepEqual(profilesSetting.value, [...others, OFFICE]);
    });

    it('makes it current while no profile is remembered, without turning it on', async () => {
      const { httpSettings, proxyManager } = setup({ profiles: [WORK] });

      assert.equal(await proxyManager.addProfile(OFFICE), 'saved');

      assert.deepEqual(proxyManager.getState().currentProfile, OFFICE);
      assert.equal(proxyManager.getState().isEnabled, false);
      assert.deepEqual(httpSettings.updates, []);
    });

    it('keeps the current profile a VS Code Profile remembers', async () => {
      const { proxyManager } = setup({
        profiles: [WORK],
        record: { isEnabled: false, currentProfile: WORK }
      });

      await proxyManager.addProfile(OFFICE);

      assert.deepEqual(proxyManager.getState().currentProfile, WORK);
    });

    it('turns it on when it matches the settings and no profile did', async () => {
      const { httpSettings, proxyManager } = setup({
        profiles: [WORK],
        http: { current: { proxy: OFFICE.proxyUrl, proxyStrictSSL: true, noProxy: [] } }
      });

      assert.equal(await proxyManager.addProfile(OFFICE), 'on');

      assert.deepEqual(proxyManager.getState().currentProfile, OFFICE);
      assert.equal(proxyManager.getState().isEnabled, true);
      assert.deepEqual(httpSettings.updates, []);
    });

    it('refuses a name an entry already holds, or a proxy URL the UI would refuse', async () => {
      const { globalState, profilesSetting, proxyManager } = setup({
        profiles: [{ name: 'office' }]
      });

      await assert.rejects(() => proxyManager.addProfile(OFFICE), ValidationError);
      await assert.rejects(
        () => proxyManager.addProfile({ ...OFFICE, name: 'Lab', proxyUrl: 'lab:8080' }),
        ValidationError
      );
      assert.deepEqual(profilesSetting.writes, []);
      assert.deepEqual(globalState.updates, []);
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

  describe('writing VS Code proxy settings', () => {
    it('turns on by writing the settings in order, then the record', async () => {
      const { httpSettings, proxyManager } = setup({ profiles: [WORK] });

      await proxyManager.enableProxy();

      assert.deepEqual(httpSettings.updates, [
        { key: 'proxy', value: 'http://proxy.example.com:8080' },
        { key: 'proxyStrictSSL', value: true },
        { key: 'noProxy', value: ['localhost'] }
      ]);
      assert.equal(proxyManager.getState().isEnabled, true);
    });

    it('reports which setting failed as a ConfigurationError', async () => {
      const { proxyManager } = setup({ profiles: [WORK], http: { failKey: 'noProxy' } });

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

    it('restores the settings it already wrote when a later write fails, and stays off', async () => {
      const { httpSettings, proxyManager } = setup({
        profiles: [WORK],
        http: { failKey: 'noProxy', current: PREVIOUS_SETTINGS }
      });

      await assert.rejects(() => proxyManager.enableProxy(), ConfigurationError);

      assert.deepEqual(httpSettings.current, PREVIOUS_SETTINGS);
      assert.equal(proxyManager.getState().isEnabled, false);
    });

    it('finishes rolling back a failed turn-on before a turn-off queued behind it starts', async () => {
      const { httpSettings, proxyManager } = setup({
        profiles: [WORK],
        http: {
          current: PREVIOUS_SETTINGS,
          // Only the turn-on's write of http.noProxy fails; the turn-off's clearing write succeeds.
          failWhen: ({ key, value }) => key === 'noProxy' && value !== undefined
        }
      });

      const [enable, disable] = await Promise.allSettled([
        proxyManager.enableProxy(),
        proxyManager.disableProxy()
      ]);

      assert.equal(enable.status, 'rejected');
      assert.equal(disable.status, 'fulfilled');
      assert.deepEqual(httpSettings.current, CLEARED);
    });

    it('leaves the proxy cleared when a later write fails while turning off', async () => {
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

    it('turns off by clearing the settings in order, then the record', async () => {
      const { httpSettings, proxyManager } = setup();

      await proxyManager.disableProxy();

      assert.deepEqual(httpSettings.updates, [
        { key: 'proxy', value: undefined },
        { key: 'proxyStrictSSL', value: undefined },
        { key: 'noProxy', value: undefined }
      ]);
      assert.deepEqual(proxyManager.getState(), { isEnabled: false, hasConfiguration: false });
    });

    it('toggles between on and off', async () => {
      const { proxyManager } = setup({ profiles: [WORK] });

      assert.equal(await proxyManager.toggleProxy(), true);
      assert.equal(proxyManager.getState().isEnabled, true);
      assert.equal(await proxyManager.toggleProxy(), false);
      assert.equal(proxyManager.getState().isEnabled, false);
    });
  });

  describe('state changes', () => {
    it('run one at a time, in call order', async () => {
      const { httpSettings, proxyManager } = setup({ profiles: [WORK] });

      const results = await Promise.all([proxyManager.toggleProxy(), proxyManager.toggleProxy()]);

      assert.deepEqual(results, [true, false]);
      assert.deepEqual(
        httpSettings.updates.map((update) => update.key),
        ['proxy', 'proxyStrictSSL', 'noProxy', 'proxy', 'proxyStrictSSL', 'noProxy']
      );
      assert.equal(proxyManager.getState().isEnabled, false);
    });

    it('each finish before the next starts, even when the first is slow', async () => {
      const fast = createProfilesSetting([WORK]);
      const profilesSetting = {
        ...fast,
        write: async (entries: readonly unknown[]): Promise<void> => {
          await new Promise((resolve) => setImmediate(resolve));
          await fast.write(entries);
        }
      };
      const proxyManager = new ProxyManager(createMemento(), createHttpSettings(), profilesSetting);
      const finished: string[] = [];
      const record = (name: string) => (): void => {
        finished.push(name);
      };

      await Promise.all([
        proxyManager.addProfile(OFFICE).then(record('add')),
        proxyManager.syncToggleState().then(record('sync')),
        proxyManager.enableProxy().then(record('enable')),
        proxyManager.disableProxy().then(record('disable'))
      ]);

      assert.deepEqual(finished, ['add', 'sync', 'enable', 'disable']);
    });

    it('run a queued change after the one before it fails', async () => {
      const { profilesSetting, proxyManager } = setup({
        profiles: [WORK],
        http: { failKey: 'noProxy' }
      });

      const [enable, add] = await Promise.allSettled([
        proxyManager.enableProxy(),
        proxyManager.addProfile(OFFICE)
      ]);

      assert.equal(enable.status, 'rejected');
      assert.equal(add.status, 'fulfilled');
      assert.deepEqual(readNames(profilesSetting.value), ['Work', 'Office']);
    });
  });

  describe('syncToggleState', () => {
    it('records that the settings are applied, without touching them or the profiles', async () => {
      const { httpSettings, profilesSetting, proxyManager } = setup({
        profiles: [WORK],
        http: { current: { proxy: WORK.proxyUrl, proxyStrictSSL: true, noProxy: ['localhost'] } }
      });

      await proxyManager.syncToggleState();

      assert.equal(proxyManager.getState().isEnabled, true);
      assert.deepEqual(httpSettings.updates, []);
      assert.deepEqual(profilesSetting.writes, []);
    });

    it('does not rewrite the record when it already matches the settings', async () => {
      const { globalState, proxyManager } = setup({ profiles: [WORK] });

      await proxyManager.syncToggleState();

      assert.deepEqual(globalState.updates, []);
    });

    it('keeps record fields it does not manage, such as ones written by another version', async () => {
      const { globalState, proxyManager } = setup({
        profiles: [WORK],
        record: { isEnabled: true, hasConfiguration: false, lastProfile: 'work' }
      });

      await proxyManager.syncToggleState();

      assert.deepEqual(globalState.store.get('proxyToggler.state'), {
        isEnabled: false,
        hasConfiguration: true,
        lastProfile: 'work'
      });
    });
  });

  describe('isConfigurationApplied', () => {
    it('is false without profiles', () => {
      assert.equal(setup().proxyManager.isConfigurationApplied(), false);
    });

    it('compares the bypass list entry by entry, whatever its shape', () => {
      const { proxyManager } = setup({
        profiles: [WORK],
        http: {
          current: { proxy: WORK.proxyUrl, proxyStrictSSL: true, noProxy: [' localhost '] }
        }
      });

      assert.equal(proxyManager.isConfigurationApplied(), true);
    });

    it('matches a reordered bypass list and a proxy URL with credentials', () => {
      const { proxyManager } = setup({
        profiles: [{ ...WORK, bypassList: ['localhost', 'b.internal'] }],
        http: {
          current: {
            proxy: 'http://alice:secret@proxy.example.com:8080',
            proxyStrictSSL: true,
            noProxy: ['b.internal', 'localhost']
          }
        }
      });

      assert.equal(proxyManager.isConfigurationApplied(), true);
    });

    it('is false when any applied value differs', () => {
      const { proxyManager } = setup({
        profiles: [WORK],
        http: { current: { proxy: WORK.proxyUrl, proxyStrictSSL: false, noProxy: [] } }
      });

      assert.equal(proxyManager.isConfigurationApplied(), false);
    });
  });
});
