import { strict as assert } from 'node:assert';

import * as sinon from 'sinon';

import { COMMANDS } from '../../src/commands/command-ids';
import { createProxyToggler } from '../../src/proxy-toggler';
import { createFakeHost, createFakeVscode, type FakeHost } from '../support/fake-vscode';
import { createExtensionContext, flushBackgroundTasks } from '../support/fakes';

const WORK = {
  name: 'Work',
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  bypassList: []
};

const HOME = { ...WORK, name: 'Home', proxyUrl: 'http://home.example:3128' };

const APPLIED_WORK = {
  'http.proxy': WORK.proxyUrl,
  'http.proxyStrictSSL': true,
  'http.noProxy': []
};

// Longer than any wait for the settings to settle.
const SETTLED = 10_000;

// A window of the VS Code that `host` stands for, in the VS Code Profile whose globalState is
// `state`.
function openWindow(host: FakeHost, state: Map<string, unknown>, focused = true) {
  const vscode = createFakeVscode({ host, focused });
  const api = createProxyToggler(vscode, createExtensionContext({ state }));
  return { vscode, api };
}

const httpWrites = (vscode: ReturnType<typeof createFakeVscode>) =>
  vscode.settingUpdates.filter(({ id }) => id.startsWith('http.'));

describe('windows and VS Code Profiles', () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => clock.restore());

  async function settle(): Promise<void> {
    await flushBackgroundTasks();
    await clock.tickAsync(SETTLED);
    await flushBackgroundTasks();
  }

  it('show a switch made in one window in every window and every VS Code Profile', async () => {
    const host = createFakeHost({ 'proxyToggler.profiles': [WORK, HOME] });
    const first = openWindow(host, new Map());
    const other = openWindow(host, new Map(), false);
    await settle();

    await first.vscode.commandHandlers.get(COMMANDS.switchProfile)?.('Home');
    await settle();
    const afterSwitch = other.api.getStatusBarText();
    await first.vscode.commandHandlers.get(COMMANDS.disable)?.();
    await settle();

    assert.equal(afterSwitch, '$(plug) Proxy: Home');
    assert.equal(other.api.getStatusBarText(), '$(debug-disconnect) Proxy: OFF');
    assert.equal(other.api.getState().currentProfile?.name, 'Home');
  });

  it('show the proxy on in a second VS Code Profile, not "Not Configured"', async () => {
    const host = createFakeHost({ 'proxyToggler.profiles': [WORK], ...APPLIED_WORK });

    const second = openWindow(host, new Map());
    await settle();

    assert.equal(second.api.getStatusBarText(), '$(plug) Proxy: ON');
  });

  it('let only the focused window write after an outside change', async () => {
    const edited = { ...WORK, proxyUrl: 'http://new.example.com:3128' };
    const host = createFakeHost({ 'proxyToggler.profiles': [WORK, HOME], ...APPLIED_WORK });
    const state = new Map<string, unknown>([
      ['proxyToggler.state', { isEnabled: true, currentProfile: WORK }]
    ]);
    const focused = openWindow(host, state);
    const unfocused = openWindow(host, state, false);
    await settle();

    // A hand edit, or Settings Sync, changes the current profile.
    focused.vscode.changeSettings({ 'proxyToggler.profiles': [edited, HOME] });
    await settle();

    assert.equal(host.settings.get('http.proxy'), edited.proxyUrl);
    assert.equal(httpWrites(focused.vscode).length, 3);
    assert.deepEqual(httpWrites(unfocused.vscode), []);
  });

  it('leave an outside change to the next window that gains focus', async () => {
    const edited = { ...WORK, proxyUrl: 'http://new.example.com:3128' };
    const host = createFakeHost({ 'proxyToggler.profiles': [WORK], ...APPLIED_WORK });
    const state = new Map<string, unknown>([
      ['proxyToggler.state', { isEnabled: true, currentProfile: WORK }]
    ]);
    const window = openWindow(host, state, false);
    await settle();

    window.vscode.changeSettings({ 'proxyToggler.profiles': [edited] });
    await settle();
    const beforeFocus = host.settings.get('http.proxy');
    window.vscode.setFocused(true);
    await settle();

    assert.equal(beforeFocus, WORK.proxyUrl);
    assert.equal(host.settings.get('http.proxy'), edited.proxyUrl);
  });
});
