import { strict as assert } from 'node:assert';

import { ProfileApplyError, ProxyManager } from '../../src/core/proxy-manager';
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
  // Each event records the http.proxy value that the next write replaces.
  const events: string[] = [];
  const notices = {
    credentialsWillBeRemoved: async (): Promise<void> => {
      events.push(`notice before ${String(httpSettings.current.proxy)}`);
    }
  };
  const proxyManager = new ProxyManager(globalState, httpSettings, profilesSetting, notices);
  return { globalState, httpSettings, profilesSetting, proxyManager, events };
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
      const { httpSettings, proxyManager } = setup({ profiles: [] });

      assert.deepEqual(proxyManager.getState(), { isEnabled: false, hasConfiguration: false });
      assert.deepEqual(await proxyManager.toggleProxy(), { kind: 'notConfigured' });
      assert.deepEqual(await proxyManager.enableProxy(), { kind: 'notConfigured' });
      assert.deepEqual(httpSettings.updates, []);
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

      const outcome = await proxyManager.enableProxy();

      assert.deepEqual(outcome, { kind: 'on', profile: HOME });
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

      assert.deepEqual(await proxyManager.toggleProxy(), { kind: 'off', profile: WORK });

      assert.deepEqual(httpSettings.current, CLEARED);
      assert.deepEqual(proxyManager.getState().currentProfile, WORK);
    });

    it('reports off with the current profile, or none when not configured', async () => {
      const configured = setup({
        profiles: [HOME, WORK],
        record: { isEnabled: true, currentProfile: WORK }
      });
      const unconfigured = setup();

      assert.deepEqual(await configured.proxyManager.disableProxy(), {
        kind: 'off',
        profile: WORK
      });
      assert.deepEqual(await unconfigured.proxyManager.disableProxy(), { kind: 'off' });
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

    it('turns a socks5 profile on and finds the settings matching it', async () => {
      const socks = { ...WORK, name: 'Tunnel', proxyUrl: 'socks5://tunnel.example.com:1080' };
      const { httpSettings, proxyManager } = setup({ profiles: [socks] });

      await proxyManager.enableProxy();

      assert.equal(httpSettings.current.proxy, socks.proxyUrl);
      assert.equal(proxyManager.hasDrift(), false);
    });

    it('switches to a named profile, turning it on and making it current', async () => {
      const { httpSettings, proxyManager } = setup({
        profiles: [WORK, HOME],
        record: { isEnabled: false, currentProfile: WORK }
      });

      const switched = await proxyManager.switchTo('home');

      assert.deepEqual(switched, { kind: 'on', profile: HOME });
      assert.equal(httpSettings.current.proxy, HOME.proxyUrl);
      assert.deepEqual(proxyManager.getState().currentProfile, HOME);
      assert.deepEqual(await proxyManager.switchTo('Office'), {
        kind: 'gone',
        name: 'Office',
        change: 'switch'
      });
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

      assert.deepEqual(await proxyManager.addProfile(OFFICE), {
        kind: 'saved',
        profile: OFFICE,
        isOn: false
      });

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

      assert.deepEqual(await proxyManager.addProfile(OFFICE), {
        kind: 'saved',
        profile: OFFICE,
        isOn: true
      });

      assert.deepEqual(proxyManager.getState().currentProfile, OFFICE);
      assert.equal(proxyManager.getState().isEnabled, true);
      assert.deepEqual(httpSettings.updates, []);
    });

    it('refuses a name an entry already holds, or a proxy URL the UI would refuse', async () => {
      const { globalState, profilesSetting, proxyManager } = setup({
        profiles: [{ name: 'office' }]
      });

      assert.deepEqual(await proxyManager.addProfile(OFFICE), {
        kind: 'nameTaken',
        name: OFFICE.name,
        reason: `"${OFFICE.name}" is already used in proxyToggler.profiles.`
      });
      await assert.rejects(
        () => proxyManager.addProfile({ ...OFFICE, name: 'Lab', proxyUrl: 'lab:8080' }),
        ValidationError
      );
      assert.deepEqual(profilesSetting.writes, []);
      assert.deepEqual(globalState.updates, []);
    });

    it('still throws for a blank or over-long name, which no input box lets through', async () => {
      const { profilesSetting, proxyManager } = setup({ profiles: [WORK] });

      for (const name of ['   ', 'N'.repeat(31)]) {
        await assert.rejects(() => proxyManager.addProfile({ ...OFFICE, name }), ValidationError);
      }
      assert.deepEqual(profilesSetting.writes, []);
    });
  });

  describe('reconciling with VS Code settings', () => {
    const applied = (profile: typeof WORK) => ({
      proxy: profile.proxyUrl,
      proxyStrictSSL: profile.strictSSL,
      noProxy: profile.bypassList
    });

    it('turns the record off when the settings are cleared', async () => {
      const { proxyManager } = setup({
        profiles: [WORK],
        record: { isEnabled: true, currentProfile: WORK }
      });

      await proxyManager.reconcile({ focused: true });

      assert.equal(proxyManager.getState().isEnabled, false);
    });

    it('makes a profile that matches the settings current and on', async () => {
      const { httpSettings, proxyManager } = setup({
        profiles: [WORK, HOME],
        record: { isEnabled: false, currentProfile: WORK },
        http: { current: applied(HOME) }
      });

      await proxyManager.reconcile({ focused: false });

      assert.deepEqual(proxyManager.getState(), {
        isEnabled: true,
        hasConfiguration: true,
        currentProfile: HOME
      });
      assert.deepEqual(httpSettings.updates, []);
    });

    it('lets the current profile win a tie', async () => {
      const twin = { ...HOME, name: 'Twin' };
      const { proxyManager } = setup({
        profiles: [twin, HOME],
        record: { isEnabled: false, currentProfile: HOME },
        http: { current: applied(HOME) }
      });

      await proxyManager.reconcile({ focused: true });

      assert.equal(proxyManager.getState().currentProfile?.name, 'Home');
    });

    it('leaves the record alone while the settings match no profile', async () => {
      const { globalState, proxyManager } = setup({
        profiles: [WORK],
        record: { isEnabled: true, currentProfile: WORK },
        http: { current: { proxy: 'http://elsewhere.example:1' } }
      });

      await proxyManager.reconcile({ focused: true });

      assert.deepEqual(globalState.updates, []);
    });

    it('writes nothing when the record is already in step', async () => {
      const { globalState, httpSettings, proxyManager } = setup({
        profiles: [WORK],
        record: { isEnabled: true, currentProfile: WORK },
        http: { current: applied(WORK) }
      });

      await proxyManager.reconcile({ focused: true });

      assert.deepEqual(globalState.updates, []);
      assert.deepEqual(httpSettings.updates, []);
    });

    describe('after an outside edit to the remembered current profile while on', () => {
      const edited = { ...WORK, proxyUrl: 'http://new.example.com:3128' };
      const outsideEdit = (http?: Parameters<typeof createHttpSettings>[0]) =>
        setup({
          profiles: [edited, HOME],
          record: { isEnabled: true, currentProfile: WORK },
          http: { current: applied(WORK), ...http }
        });

      it('re-applies it in the focused window and remembers the new values', async () => {
        const { httpSettings, proxyManager } = outsideEdit();

        await proxyManager.reconcile({ focused: true });

        assert.equal(httpSettings.current.proxy, edited.proxyUrl);
        assert.deepEqual(proxyManager.getState().currentProfile, edited);
        assert.equal(proxyManager.getState().isEnabled, true);
      });

      it('leaves it to the focused window when this one has no focus', async () => {
        const { globalState, httpSettings, proxyManager } = outsideEdit();

        await proxyManager.reconcile({ focused: false });

        assert.deepEqual(httpSettings.updates, []);
        assert.deepEqual(globalState.updates, []);
      });

      it('keeps the remembered values when re-applying fails', async () => {
        const { globalState, proxyManager } = outsideEdit({ failKey: 'noProxy' });

        await assert.rejects(() => proxyManager.reconcile({ focused: true }), ConfigurationError);

        assert.deepEqual(
          (globalState.store.get('proxyToggler.state') as { currentProfile: unknown })
            .currentProfile,
          WORK
        );
      });
    });

    it('never re-applies a profile that is current only through the fallback', async () => {
      const gone = { ...WORK, name: 'Gone' };
      const { httpSettings, globalState, proxyManager } = setup({
        profiles: [HOME],
        record: { isEnabled: true, currentProfile: gone },
        http: { current: applied(gone) }
      });

      await proxyManager.reconcile({ focused: true });

      assert.deepEqual(httpSettings.updates, []);
      assert.deepEqual(globalState.updates, []);
    });
  });

  describe('own changes', () => {
    it('are known while their writes are under way, and only then', async () => {
      const seen: boolean[] = [];
      const httpSettings = createHttpSettings();
      const proxyManager = new ProxyManager(
        createMemento(),
        {
          ...httpSettings,
          update: async (key, value) => {
            // VS Code fires the change event before the update resolves.
            seen.push(proxyManager.isMakingOwnChange());
            await httpSettings.update(key, value);
          }
        },
        createProfilesSetting([WORK])
      );

      await proxyManager.enableProxy();

      assert.deepEqual(seen, [true, true, true]);
      assert.equal(proxyManager.isMakingOwnChange(), false);
    });
  });

  describe('credentials in http.proxy', () => {
    const WITH_CREDENTIALS = 'http://alice:secret@proxy.example.com:8080';

    it('says so before it first overwrites them, then writes', async () => {
      const { events, httpSettings, proxyManager } = setup({
        profiles: [WORK, HOME],
        record: { isEnabled: true, currentProfile: WORK },
        http: { current: { proxy: WITH_CREDENTIALS } }
      });

      await proxyManager.switchTo('Home');

      assert.deepEqual(events, [`notice before ${WITH_CREDENTIALS}`]);
      assert.equal(httpSettings.current.proxy, HOME.proxyUrl);
    });

    it('says so before it clears them', async () => {
      const { events, proxyManager } = setup({
        profiles: [WORK],
        record: { isEnabled: true, currentProfile: WORK },
        http: { current: { proxy: WITH_CREDENTIALS } }
      });

      await proxyManager.disableProxy();

      assert.deepEqual(events, [`notice before ${WITH_CREDENTIALS}`]);
    });

    it('says nothing when http.proxy holds none', async () => {
      const { events, proxyManager } = setup({
        profiles: [WORK],
        http: { current: { proxy: HOME.proxyUrl } }
      });

      await proxyManager.enableProxy();
      await proxyManager.disableProxy();

      assert.deepEqual(events, []);
    });
  });

  describe('editing a profile', () => {
    const APPLIED = { proxy: WORK.proxyUrl, proxyStrictSSL: true, noProxy: ['localhost'] };
    const EDITED = { ...WORK, proxyUrl: 'http://new.example.com:3128' };

    it('saves it over its own entry, keeping unknown fields and every other entry', async () => {
      const { profilesSetting, proxyManager } = setup({
        profiles: [{ ...WORK, color: 'blue' }, HOME]
      });

      await proxyManager.updateProfile('Work', EDITED);

      assert.deepEqual(profilesSetting.value, [{ ...EDITED, color: 'blue' }, HOME]);
    });

    it('re-applies the current profile while on, and remembers the edit', async () => {
      const { globalState, httpSettings, proxyManager } = setup({
        profiles: [WORK, HOME],
        record: { isEnabled: true, currentProfile: WORK },
        http: { current: APPLIED }
      });

      await proxyManager.updateProfile('Work', EDITED);

      assert.equal(httpSettings.current.proxy, EDITED.proxyUrl);
      assert.deepEqual(
        (globalState.store.get('proxyToggler.state') as { currentProfile: unknown }).currentProfile,
        EDITED
      );
    });

    it('reports that the profile was saved when re-applying it fails', async () => {
      const { globalState, httpSettings, profilesSetting, proxyManager } = setup({
        profiles: [WORK, HOME],
        record: { isEnabled: true, currentProfile: WORK },
        http: { current: APPLIED, failKey: 'noProxy' }
      });

      await assert.rejects(
        () => proxyManager.updateProfile('Work', EDITED),
        (error: unknown) => {
          assert.ok(error instanceof ProfileApplyError);
          assert.ok(error.cause instanceof ConfigurationError);
          assert.equal(error.cause.key, 'noProxy');
          assert.match(error.toUserMessage(), /saved Work.*could not.*apply/i);
          assert.doesNotMatch(error.toUserMessage(), /enable the proxy/i);
          return true;
        }
      );
      assert.deepEqual(profilesSetting.value, [EDITED, HOME]);
      assert.deepEqual(httpSettings.current, APPLIED);
      assert.deepEqual(
        (globalState.store.get('proxyToggler.state') as { currentProfile: unknown }).currentProfile,
        WORK
      );
    });

    it('keeps rollback failures in the saved-profile error', async () => {
      const { proxyManager } = setup({
        profiles: [WORK],
        record: { isEnabled: true, currentProfile: WORK },
        http: {
          current: APPLIED,
          failWhen: ({ key, value }) =>
            key === 'noProxy' || (key === 'proxy' && value === WORK.proxyUrl)
        }
      });

      await assert.rejects(
        () => proxyManager.updateProfile('Work', EDITED),
        (error: unknown) => {
          assert.ok(error instanceof ProfileApplyError);
          assert.ok(error.cause instanceof ConfigurationError);
          assert.equal(error.cause.key, 'noProxy');
          assert.equal(error.cause.restoreErrors.has('proxy'), true);
          assert.match(error.toUserMessage(), /Saved Work.*could not.*apply/);
          assert.match(error.toUserMessage(), /could not be restored.*http\.proxy/);
          return true;
        }
      );
    });

    it('words a failed setting write that lies deeper in the cause chain', () => {
      const wrapped = new Error('wrapped', { cause: new ConfigurationError('enable', 'noProxy') });

      const message = new ProfileApplyError('Work', wrapped).toUserMessage();

      assert.match(message, /^Saved Work, but could not fully apply the changes because/);
      assert.match(message, /"http\.noProxy"/);
      assert.doesNotMatch(message, /output/i);
    });

    it('reports a saved profile when an unexpected error prevents re-application', async () => {
      const globalState = createMemento(
        new Map([['proxyToggler.state', { isEnabled: true, currentProfile: WORK }]])
      );
      const httpSettings = createHttpSettings({
        current: { ...APPLIED, proxy: 'http://alice:secret@proxy.example.com:8080' }
      });
      const profilesSetting = createProfilesSetting([WORK]);
      const manager = new ProxyManager(globalState, httpSettings, profilesSetting, {
        credentialsWillBeRemoved: async () => {
          throw new Error('unexpected notice failure');
        }
      });

      await assert.rejects(
        () => manager.updateProfile('Work', EDITED),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /saved Work.*could not.*apply/i);
          assert.doesNotMatch(error.message, /alice|secret/);
          assert.match(String(error.cause), /unexpected notice failure/);
          return true;
        }
      );
      assert.deepEqual(profilesSetting.value, [EDITED]);
    });

    it('follows a rename of the current profile without touching the settings while off', async () => {
      const { httpSettings, proxyManager } = setup({
        profiles: [WORK, HOME],
        record: { isEnabled: false, currentProfile: WORK }
      });

      await proxyManager.updateProfile('Work', { ...WORK, name: 'Office' });

      assert.equal(proxyManager.getState().currentProfile?.name, 'Office');
      assert.deepEqual(httpSettings.updates, []);
    });

    it('reports a rename, and whether the saved profile is on', async () => {
      const office = { ...WORK, name: 'Office' };
      const homeWithStrictSSL = { ...HOME, strictSSL: true };
      const withWorkCurrent = (isEnabled: boolean) =>
        setup({
          profiles: [WORK, HOME],
          record: { isEnabled, currentProfile: WORK },
          http: { current: isEnabled ? APPLIED : {} }
        }).proxyManager;

      assert.deepEqual(
        await withWorkCurrent(true).updateProfile('Work', { ...office, name: ' Office ' }),
        { kind: 'saved', profile: office, renamedFrom: 'Work', isOn: true }
      );
      assert.deepEqual(await withWorkCurrent(false).updateProfile('Work', office), {
        kind: 'saved',
        profile: office,
        renamedFrom: 'Work',
        isOn: false
      });
      // The proxy is on, but with Work.
      assert.deepEqual(await withWorkCurrent(true).updateProfile('Home', homeWithStrictSSL), {
        kind: 'saved',
        profile: homeWithStrictSSL,
        isOn: false
      });
    });

    it('reports no rename when only the letter case of the name changes', async () => {
      // Names match ignoring case, so a keybinding that names the old spelling keeps working.
      const work = { ...WORK, name: 'work' };
      const { proxyManager } = setup({
        profiles: [WORK, HOME],
        record: { isEnabled: true, currentProfile: WORK },
        http: { current: APPLIED }
      });

      assert.deepEqual(await proxyManager.updateProfile('Work', work), {
        kind: 'saved',
        profile: work,
        isOn: true
      });
    });

    it('leaves the settings and the record alone when the profile is not current', async () => {
      const { globalState, httpSettings, proxyManager } = setup({
        profiles: [WORK, HOME],
        record: { isEnabled: true, currentProfile: WORK },
        http: { current: APPLIED }
      });

      await proxyManager.updateProfile('Home', { ...HOME, strictSSL: true });

      assert.deepEqual(httpSettings.updates, []);
      assert.deepEqual(globalState.updates, []);
    });

    it('refuses a name another entry holds, but accepts its own in other letter case', async () => {
      const { proxyManager } = setup({ profiles: [WORK, HOME] });

      assert.deepEqual(await proxyManager.updateProfile('Work', { ...WORK, name: 'home' }), {
        kind: 'nameTaken',
        name: 'home',
        reason: '"home" is already used in proxyToggler.profiles.'
      });
      await proxyManager.updateProfile('Work', { ...WORK, name: 'WORK' });

      assert.equal(proxyManager.getProfiles()[0]?.name, 'WORK');
    });

    it('reports a name another entry took during an edit', async () => {
      // Another window, or Settings Sync, added an entry with that name, which the switcher hides.
      const { globalState, httpSettings, profilesSetting, proxyManager } = setup({
        profiles: [WORK, HOME, { name: 'Lab' }],
        record: { isEnabled: true, currentProfile: WORK },
        http: { current: APPLIED }
      });

      const outcome = await proxyManager.updateProfile('Work', { ...EDITED, name: ' lab ' });

      assert.deepEqual(outcome, {
        kind: 'nameTaken',
        name: 'lab',
        reason: '"lab" is already used in proxyToggler.profiles.'
      });
      assert.deepEqual(profilesSetting.writes, []);
      assert.deepEqual(httpSettings.updates, []);
      assert.deepEqual(globalState.updates, []);
    });

    it('keeps its name when a hidden later entry holds the same one', async () => {
      // The first entry with a name owns it, as after a Settings Sync merge kept both sides.
      const duplicate = { ...WORK, proxyUrl: 'http://other.example.com:3128' };
      const { profilesSetting, proxyManager } = setup({ profiles: [WORK, duplicate] });

      await proxyManager.updateProfile('Work', EDITED);

      assert.deepEqual(profilesSetting.value, [EDITED, duplicate]);
    });

    it('refuses an edit of a profile that is gone, and writes nothing', async () => {
      // Another window, or Settings Sync, removed it while the edit was open.
      const { profilesSetting, proxyManager } = setup({ profiles: [HOME] });

      assert.deepEqual(await proxyManager.updateProfile('Work', EDITED), {
        kind: 'gone',
        name: 'Work',
        change: 'save'
      });
      // Gone is decided first: Work may have been renamed to the very name that is now taken.
      assert.deepEqual(await proxyManager.updateProfile('Work', { ...EDITED, name: 'home' }), {
        kind: 'gone',
        name: 'Work',
        change: 'save'
      });

      assert.deepEqual(profilesSetting.value, [HOME]);
      assert.deepEqual(profilesSetting.writes ?? [], []);
    });

    it('refuses values the UI would refuse', async () => {
      const { profilesSetting, proxyManager } = setup({ profiles: [WORK] });

      for (const edited of [
        { ...WORK, name: '   ' },
        { ...WORK, name: 'N'.repeat(31) },
        { ...WORK, proxyUrl: 'proxy.example.com' },
        { ...WORK, bypassList: ['*'] }
      ]) {
        await assert.rejects(() => proxyManager.updateProfile('Work', edited), ValidationError);
      }
      assert.deepEqual(profilesSetting.writes, []);
    });
  });

  describe('deleting a profile', () => {
    it('turns the proxy off first when the current profile is on, then makes the first remaining profile current', async () => {
      const { httpSettings, profilesSetting, proxyManager } = setup({
        profiles: [WORK, OFFICE, HOME],
        record: { isEnabled: true, currentProfile: WORK },
        http: { current: { proxy: WORK.proxyUrl, proxyStrictSSL: true, noProxy: ['localhost'] } }
      });

      await proxyManager.deleteProfile('Work');

      assert.deepEqual(httpSettings.current, CLEARED);
      assert.deepEqual(profilesSetting.value, [OFFICE, HOME]);
      assert.deepEqual(proxyManager.getState(), {
        isEnabled: false,
        hasConfiguration: true,
        currentProfile: HOME
      });
    });

    it('returns to not configured when the last profile goes', async () => {
      const { proxyManager } = setup({
        profiles: [WORK],
        record: { isEnabled: false, currentProfile: WORK }
      });

      await proxyManager.deleteProfile('Work');

      assert.deepEqual(proxyManager.getState(), { isEnabled: false, hasConfiguration: false });
    });

    it('leaves the record and the settings alone when another profile goes', async () => {
      const { httpSettings, proxyManager } = setup({
        profiles: [WORK, HOME],
        record: { isEnabled: true, currentProfile: WORK }
      });

      await proxyManager.deleteProfile('Home');

      assert.deepEqual(httpSettings.updates, []);
      assert.deepEqual(proxyManager.getState(), {
        isEnabled: true,
        hasConfiguration: true,
        currentProfile: WORK
      });
    });

    it('reports a delete, or a profile already gone, writing nothing then', async () => {
      const { globalState, httpSettings, profilesSetting, proxyManager } = setup({
        profiles: [WORK, HOME]
      });

      assert.deepEqual(await proxyManager.deleteProfile('Home'), { kind: 'deleted', name: 'Home' });
      const writes = [...profilesSetting.writes];
      const records = [...globalState.updates];
      // Another window, or Settings Sync, already removed it.
      assert.deepEqual(await proxyManager.deleteProfile('Home'), {
        kind: 'gone',
        name: 'Home',
        change: 'delete'
      });

      assert.deepEqual(profilesSetting.writes, writes);
      assert.deepEqual(globalState.updates, records);
      assert.deepEqual(httpSettings.updates, []);
    });

    it('keeps the current profile when turning it off fails during a delete', async () => {
      const { profilesSetting, proxyManager } = setup({
        profiles: [WORK, HOME],
        record: { isEnabled: true, currentProfile: WORK },
        http: {
          current: { proxy: WORK.proxyUrl, proxyStrictSSL: true, noProxy: ['localhost'] },
          failKey: 'proxy'
        }
      });

      await assert.rejects(
        () => proxyManager.deleteProfile('Work'),
        (error: unknown) => {
          assert.ok(error instanceof ConfigurationError);
          assert.equal(error.operation, 'disable');
          return true;
        }
      );

      assert.deepEqual(profilesSetting.value, [WORK, HOME]);
      assert.deepEqual(profilesSetting.writes, []);
      assert.deepEqual(proxyManager.getState().currentProfile, WORK);
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

      assert.deepEqual(await proxyManager.toggleProxy(), { kind: 'on', profile: WORK });
      assert.equal(proxyManager.getState().isEnabled, true);
      assert.deepEqual(await proxyManager.toggleProxy(), { kind: 'off', profile: WORK });
      assert.equal(proxyManager.getState().isEnabled, false);
    });
  });

  describe('state changes', () => {
    it('run one at a time, in call order', async () => {
      const { httpSettings, proxyManager } = setup({ profiles: [WORK] });

      await Promise.all([proxyManager.toggleProxy(), proxyManager.toggleProxy()]);

      assert.deepEqual(
        httpSettings.updates.map((update) => update.key),
        ['proxy', 'proxyStrictSSL', 'noProxy', 'proxy', 'proxyStrictSSL', 'noProxy']
      );
      assert.equal(proxyManager.getState().isEnabled, false);
    });

    it('reports each of two overlapping toggles once, in order', async () => {
      // A double click on the status bar.
      const { httpSettings, proxyManager } = setup({ profiles: [WORK] });

      const outcomes = await Promise.all([proxyManager.toggleProxy(), proxyManager.toggleProxy()]);

      assert.deepEqual(
        outcomes.map(({ kind }) => kind),
        ['on', 'off']
      );
      assert.equal(httpSettings.current.proxy, undefined);
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
        proxyManager.reconcile({ focused: true }).then(record('reconcile')),
        proxyManager.enableProxy().then(record('enable')),
        proxyManager.disableProxy().then(record('disable'))
      ]);

      assert.deepEqual(finished, ['add', 'reconcile', 'enable', 'disable']);
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

  describe('the stored record', () => {
    it('keeps fields it does not manage, such as ones written by another version', async () => {
      const { globalState, proxyManager } = setup({
        profiles: [WORK],
        record: { isEnabled: true, hasConfiguration: false, lastProfile: 'work' }
      });

      await proxyManager.reconcile({ focused: true });

      assert.deepEqual(globalState.store.get('proxyToggler.state'), {
        isEnabled: false,
        hasConfiguration: true,
        lastProfile: 'work'
      });
    });
  });
});
