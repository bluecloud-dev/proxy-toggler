import { strict as assert } from 'node:assert';

import type { QuickPickItem } from 'vscode';

import { createProxyToggler } from '../../src/proxy-toggler';
import {
  createFakeVscode,
  type FakeQuickPick,
  type FakeVscodeOptions
} from '../support/fake-vscode';
import { createExtensionContext, flushBackgroundTasks } from '../support/fakes';

const WORK = {
  name: 'Work',
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  bypassList: ['localhost']
};

const HOME = {
  name: 'Home',
  proxyUrl: 'http://home.example:3128',
  strictSSL: true,
  bypassList: []
};

const PROFILES = { 'proxyToggler.profiles': [WORK, HOME] };

function activate(options: FakeVscodeOptions = {}, record?: unknown) {
  const vscode = createFakeVscode({ settings: PROFILES, ...options });
  const state = new Map<string, unknown>(
    record === undefined ? [] : [['proxyToggler.state', record]]
  );
  const api = createProxyToggler(vscode, createExtensionContext({ state }));
  return { vscode, api };
}

const switchProfile = async (
  vscode: ReturnType<typeof createFakeVscode>,
  ...args: unknown[]
): Promise<void> => {
  await vscode.commandHandlers.get('proxyToggler.switchProfile')?.(...args);
};

// Accepts the item with this label, as a click or the arrow keys and Enter do.
const choose =
  (label: string) =>
  (quickPick: FakeQuickPick): void => {
    quickPick.accept(quickPick.items.find((item: QuickPickItem) => item.label === label));
  };

describe('switcher', () => {
  it('lists the profiles alphabetically, with the current one checked and focused, then the actions', async () => {
    const { vscode } = activate({}, { isEnabled: false, currentProfile: WORK });

    await switchProfile(vscode);

    const [quickPick] = vscode.quickPicks;
    assert.deepEqual(
      quickPick?.items.map((item) => [item.label, item.description]),
      [
        ['Home', HOME.proxyUrl],
        ['$(check) Work', WORK.proxyUrl],
        ['', undefined],
        ['Turn Proxy On', undefined],
        ['Add Profile…', undefined],
        ['Extension Settings', undefined]
      ]
    );
    assert.equal(quickPick?.activeItems[0]?.label, '$(check) Work');
  });

  it('turns on the profile picked, making it current', async () => {
    const { vscode, api } = activate({ quickPick: choose('Home') });

    await switchProfile(vscode);

    assert.equal(vscode.settings.get('http.proxy'), HOME.proxyUrl);
    assert.equal(api.getState().currentProfile?.name, 'Home');
    assert.match(api.getStatusBarText() ?? '', /proxy: home/i);
  });

  it('keeps the current profile when Enter accepts it while on', async () => {
    const { vscode } = activate(
      { quickPick: (quickPick) => quickPick.accept() },
      { isEnabled: true, currentProfile: WORK }
    );

    await switchProfile(vscode);

    assert.deepEqual(vscode.settingUpdates, []);
  });

  it('turns the current profile on when Enter accepts it while off', async () => {
    const { vscode, api } = activate(
      { quickPick: (quickPick) => quickPick.accept() },
      { isEnabled: false, currentProfile: WORK }
    );

    await switchProfile(vscode);

    assert.equal(vscode.settings.get('http.proxy'), WORK.proxyUrl);
    assert.equal(api.getState().isEnabled, true);
  });

  it('turns the proxy off', async () => {
    const { vscode, api } = activate(
      {
        quickPick: choose('Turn Proxy Off'),
        settings: { ...PROFILES, 'http.proxy': WORK.proxyUrl }
      },
      { isEnabled: true, currentProfile: WORK }
    );

    await switchProfile(vscode);

    assert.equal(vscode.settings.has('http.proxy'), false);
    assert.equal(api.getState().isEnabled, false);
  });

  it('opens the extension settings', async () => {
    const { vscode } = activate({ quickPick: choose('Extension Settings') });

    await switchProfile(vscode);

    assert.deepEqual(vscode.executedCommands.at(-1), {
      command: 'workbench.action.openSettings',
      args: ['@ext:aymenhammouda.proxy-toggler']
    });
  });

  it('switches to the profile a keybinding names, ignoring letter case', async () => {
    const { vscode, api } = activate();

    await switchProfile(vscode, 'home');

    assert.equal(vscode.settings.get('http.proxy'), HOME.proxyUrl);
    assert.equal(api.getState().currentProfile?.name, 'Home');
    assert.equal(vscode.quickPicks.length, 0);
  });

  it('shows an error and the switcher when a keybinding names no profile', async () => {
    const { vscode } = activate();

    await switchProfile(vscode, 'Office');

    assert.deepEqual(
      vscode.messages.map(({ kind, message }) => [kind, message]),
      [['error', 'No proxy profile is named "Office".']]
    );
    assert.equal(vscode.quickPicks.length, 1);
  });

  it('can be opened from the status bar gear', () => {
    const { vscode } = activate();

    const gear = vscode.statusBarItems.find((item) => item.text === '$(gear)');

    assert.equal(gear?.command, 'proxyToggler.switchProfile');
    assert.equal(gear?.accessibilityInformation?.label, 'Switch proxy profile');
  });

  describe('success toasts', () => {
    it('are not shown by default', async () => {
      const { vscode } = activate({ quickPick: choose('Home') });

      await switchProfile(vscode);
      await flushBackgroundTasks();

      assert.deepEqual(vscode.messages, []);
    });

    it('name the profile, without buttons, when showSwitchNotifications is on', async () => {
      const { vscode } = activate({
        quickPick: choose('Home'),
        settings: { ...PROFILES, 'proxyToggler.showSwitchNotifications': true }
      });

      await switchProfile(vscode);

      assert.deepEqual(vscode.messages, [
        { kind: 'info', message: 'Proxy Toggler turned on Home.', items: [] }
      ]);
    });
  });
});
