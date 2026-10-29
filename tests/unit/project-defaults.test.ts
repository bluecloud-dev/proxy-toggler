import { strict as assert } from 'node:assert';

import * as sinon from 'sinon';
import type { QuickPickItem } from 'vscode';

import { COMMANDS } from '../../src/commands/command-ids';
import { createProxyToggler } from '../../src/proxy-toggler';
import {
  createFakeHost,
  createFakeVscode,
  type FakeHost,
  type FakeQuickPick,
  type FakeVscodeOptions
} from '../support/fake-vscode';
import { createExtensionContext, flushBackgroundTasks } from '../support/fakes';

const WORK = {
  name: 'Work',
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  bypassList: []
};

const HOME = { ...WORK, name: 'Home', proxyUrl: 'http://home.example:3128' };

const PROFILES = { 'proxyToggler.profiles': [WORK, HOME] };

const APPLIED_HOME = {
  'http.proxy': HOME.proxyUrl,
  'http.proxyStrictSSL': true,
  'http.noProxy': []
};

const WORK_PROJECT = { 'proxyToggler.defaultProfile': 'Work' };

// No proxy for every project that names no default of its own.
const NO_PROXY_BY_DEFAULT = { 'proxyToggler.defaultProfile': false };

// Longer than any wait for the settings to settle.
const SETTLED = 10_000;

// A window of the VS Code that `host` stands for; every window here shares one VS Code Profile.
function openWindow(
  host: FakeHost,
  state: Map<string, unknown>,
  options: Omit<FakeVscodeOptions, 'host'> = {}
) {
  const vscode = createFakeVscode({ host, ...options });
  const context = createExtensionContext({ state });
  const api = createProxyToggler(vscode, context);
  return { vscode, context, api };
}

type Window = ReturnType<typeof openWindow>;

const choose =
  (label: string) =>
  (quickPick: FakeQuickPick): void => {
    quickPick.accept(quickPick.items.find((item: QuickPickItem) => item.label === label));
  };

describe('project defaults', () => {
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

  // Moves focus from one window to another, as VS Code does: the old window loses it first.
  async function focus(from: Window, to: Window): Promise<void> {
    from.vscode.setFocused(false);
    to.vscode.setFocused(true);
    await settle();
  }

  it("turns on the project's default profile when its window opens with focus", async () => {
    const host = createFakeHost({ ...PROFILES, ...APPLIED_HOME });
    openWindow(host, new Map(), { workspace: WORK_PROJECT });

    await settle();

    assert.equal(host.settings.get('http.proxy'), WORK.proxyUrl);
  });

  it('switches the proxy as focus moves between projects', async () => {
    const host = createFakeHost({ ...PROFILES, ...NO_PROXY_BY_DEFAULT });
    const state = new Map<string, unknown>();
    const work = openWindow(host, state, { workspace: WORK_PROJECT });
    const personal = openWindow(host, state, { workspace: {}, focused: false });
    await settle();
    const inWork = host.settings.get('http.proxy');

    await focus(work, personal);
    const inPersonal = host.settings.get('http.proxy');
    await focus(personal, work);

    assert.equal(inWork, WORK.proxyUrl);
    assert.equal(inPersonal, undefined);
    assert.equal(host.settings.get('http.proxy'), WORK.proxyUrl);
  });

  it('never acts in a window without focus', async () => {
    const host = createFakeHost({ ...PROFILES, ...APPLIED_HOME });
    const { vscode } = openWindow(host, new Map(), { workspace: WORK_PROJECT, focused: false });

    await settle();

    assert.equal(host.settings.get('http.proxy'), HOME.proxyUrl);
    assert.deepEqual(
      vscode.settingUpdates.filter(({ id }) => id.startsWith('http.')),
      []
    );
  });

  it('leaves the proxy alone in a window with no default anywhere', async () => {
    const host = createFakeHost({ ...PROFILES, ...APPLIED_HOME });
    const state = new Map<string, unknown>([
      ['proxyToggler.state', { isEnabled: true, currentProfile: HOME }]
    ]);
    const first = openWindow(host, state, { workspace: {} });
    const second = openWindow(host, state, { workspace: {}, focused: false });
    await settle();

    await focus(first, second);

    assert.equal(host.settings.get('http.proxy'), HOME.proxyUrl);
  });

  it("keeps a manual change in a window when focus comes back, over the project's default", async () => {
    const host = createFakeHost({ ...PROFILES, ...NO_PROXY_BY_DEFAULT });
    const state = new Map<string, unknown>();
    const work = openWindow(host, state, { workspace: WORK_PROJECT });
    const personal = openWindow(host, state, { workspace: {}, focused: false });
    await settle();

    await work.vscode.commandHandlers.get(COMMANDS.switchProfile)?.('Home');
    await focus(work, personal);
    await focus(personal, work);

    assert.equal(host.settings.get('http.proxy'), HOME.proxyUrl);
  });

  it("applies a changed project default at once, replacing the window's manual change", async () => {
    const host = createFakeHost(PROFILES);
    const work = openWindow(host, new Map(), { workspace: WORK_PROJECT });
    await settle();
    await work.vscode.commandHandlers.get(COMMANDS.disable)?.();
    await settle();

    work.vscode.changeWorkspaceSettings({ 'proxyToggler.defaultProfile': 'Home' });
    await settle();

    assert.equal(host.settings.get('http.proxy'), HOME.proxyUrl);
  });

  it('says nothing when it switches by itself, even with switch notifications on', async () => {
    const host = createFakeHost({ ...PROFILES, 'proxyToggler.showSwitchNotifications': true });
    const { vscode } = openWindow(host, new Map(), { workspace: WORK_PROJECT });

    await settle();

    assert.equal(host.settings.get('http.proxy'), WORK.proxyUrl);
    assert.deepEqual(vscode.messages, []);
  });

  describe('a project that names a profile you lack', () => {
    const OFFICE_PROJECT = { 'proxyToggler.defaultProfile': 'Office' };

    it('leaves the proxy alone and asks once to add the profile', async () => {
      const host = createFakeHost({ ...PROFILES, ...APPLIED_HOME });
      const state = new Map<string, unknown>([
        ['proxyToggler.state', { isEnabled: true, currentProfile: HOME }]
      ]);
      const office = openWindow(host, state, { workspace: OFFICE_PROJECT });
      const other = openWindow(host, state, { workspace: {}, focused: false });
      await settle();

      await focus(office, other);
      await focus(other, office);

      assert.equal(host.settings.get('http.proxy'), HOME.proxyUrl);
      assert.deepEqual(
        office.vscode.messages.map(({ kind, message, items }) => ({ kind, message, items })),
        [
          {
            kind: 'warning',
            message: "This project uses the proxy profile Office, which you don't have.",
            items: ['Add Profile…']
          }
        ]
      );
    });

    it('starts adding a profile from the prompt', async () => {
      const host = createFakeHost(PROFILES);
      const { vscode } = openWindow(host, new Map(), {
        workspace: OFFICE_PROJECT,
        answer: () => 'Add Profile…'
      });

      await settle();

      assert.equal(vscode.inputBoxes.length, 1);
    });
  });

  describe('integrated terminals', () => {
    it("get each window's own choice, whichever window has focus", async () => {
      const host = createFakeHost({
        ...PROFILES,
        ...NO_PROXY_BY_DEFAULT,
        'proxyToggler.applyToTerminals': true
      });
      const state = new Map<string, unknown>();
      const work = openWindow(host, state, { workspace: WORK_PROJECT });
      const personal = openWindow(host, state, { workspace: {}, focused: false });
      await settle();

      await focus(work, personal);

      assert.equal(host.settings.get('http.proxy'), undefined);
      assert.equal(
        work.context.environmentVariableCollection.variables.get('HTTPS_PROXY'),
        WORK.proxyUrl
      );
      assert.equal(personal.context.environmentVariableCollection.variables.size, 0);
    });
  });

  describe('status bar', () => {
    const tooltipOf = (window: Window) => window.vscode.statusBarItems[0]?.tooltip as string;

    it('says whether the proxy is the default of the project, of the user, or set in the window', async () => {
      const host = createFakeHost({ ...PROFILES, ...NO_PROXY_BY_DEFAULT });
      const state = new Map<string, unknown>();
      const work = openWindow(host, state, { workspace: WORK_PROJECT });
      const personal = openWindow(host, state, { workspace: {}, focused: false });
      await settle();
      const projectDefault = tooltipOf(work);

      await focus(work, personal);
      const userDefault = tooltipOf(personal);
      await personal.vscode.commandHandlers.get(COMMANDS.enable)?.();
      await settle();

      assert.match(projectDefault, /This project's default\./);
      assert.match(userDefault, /Your default\./);
      assert.match(tooltipOf(personal), /Changed in this window\./);
    });
  });

  describe('switcher', () => {
    const openSwitcher = (window: Window) =>
      window.vscode.commandHandlers.get(COMMANDS.switchProfile)?.();

    it("makes the current profile this project's default", async () => {
      const host = createFakeHost({ ...PROFILES, ...APPLIED_HOME });
      const window = openWindow(
        host,
        new Map([['proxyToggler.state', { isEnabled: true, currentProfile: HOME }]]),
        { workspace: {}, quickPick: choose('Use Home in This Project') }
      );
      await settle();

      await openSwitcher(window);
      await settle();

      assert.equal(window.vscode.workspaceSettings?.get('proxyToggler.defaultProfile'), 'Home');
      assert.equal(host.settings.has('proxyToggler.defaultProfile'), false);
    });

    it('turns the proxy off as the project switches to no proxy', async () => {
      const host = createFakeHost({ ...PROFILES, ...APPLIED_HOME });
      const window = openWindow(
        host,
        new Map([['proxyToggler.state', { isEnabled: true, currentProfile: HOME }]]),
        { workspace: {}, quickPick: choose('Use No Proxy in This Project') }
      );
      await settle();

      await openSwitcher(window);
      await settle();

      assert.equal(window.vscode.workspaceSettings?.get('proxyToggler.defaultProfile'), false);
      assert.equal(host.settings.has('http.proxy'), false);
    });

    it("removes this project's default", async () => {
      const host = createFakeHost(PROFILES);
      const window = openWindow(host, new Map(), {
        workspace: WORK_PROJECT,
        quickPick: choose('Stop Using a Project Default')
      });
      await settle();

      await openSwitcher(window);
      await settle();

      assert.equal(window.vscode.workspaceSettings?.has('proxyToggler.defaultProfile'), false);
    });

    it('offers no project entries while no folder is open', async () => {
      const host = createFakeHost(PROFILES);
      const labels: string[] = [];
      const window = openWindow(host, new Map(), {
        quickPick: (quickPick) => {
          labels.push(...quickPick.items.map((item: QuickPickItem) => item.label));
          quickPick.dismiss();
        }
      });
      await settle();

      await openSwitcher(window);

      assert.equal(
        labels.some((label) => /This Project/.test(label)),
        false
      );
    });
  });
});
