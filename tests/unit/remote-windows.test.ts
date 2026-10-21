import { strict as assert } from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import * as sinon from 'sinon';

import { COMMANDS } from '../../src/commands/command-ids';
import { createProxyToggler } from '../../src/proxy-toggler';
import {
  createFakeHost,
  createFakeRemote,
  createFakeVscode,
  type FakeHost,
  type FakeRemote,
  type FakeVscode
} from '../support/fake-vscode';
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

// The toggle is the status bar item that comes first.
const toggleOf = (vscode: FakeVscode) => {
  const toggle = vscode.statusBarItems[0];
  assert.ok(toggle);
  return toggle;
};

// Longer than any wait for the settings to settle.
const SETTLED = 10_000;

describe('remote windows', () => {
  let clock: sinon.SinonFakeTimers;
  let storageRoot: string;

  beforeEach(async () => {
    clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-toggler-remote-'));
  });
  afterEach(async () => {
    clock.restore();
    await fs.rm(storageRoot, { recursive: true, force: true });
  });

  async function settle(): Promise<void> {
    await flushBackgroundTasks();
    await clock.tickAsync(SETTLED);
    await flushBackgroundTasks();
  }

  // A window of the VS Code that `host` stands for, in the VS Code Profile whose globalState is
  // `state`; with `remote`, a remote window on that machine, whose global storage is its own.
  function openWindow(
    host: FakeHost,
    state: Map<string, unknown>,
    remote?: FakeRemote,
    options: { remoteSeesLocalProxy?: boolean; focused?: boolean } = {}
  ) {
    const vscode = createFakeVscode({ host, remote, ...options });
    const globalStorage = remote ? path.join(storageRoot, remote.name) : undefined;
    const api = createProxyToggler(vscode, createExtensionContext({ state, globalStorage }));
    return { vscode, api };
  }

  it("switch only the remote machine's settings and record in an SSH window", async () => {
    const host = createFakeHost({ 'proxyToggler.profiles': [WORK, HOME] });
    // This VS Code Profile last used Home, and its proxy is off.
    const localState = new Map<string, unknown>([
      ['proxyToggler.state', { isEnabled: false, hasConfiguration: true, currentProfile: HOME }]
    ]);
    const remote = createFakeRemote('ssh-remote');
    const ssh = openWindow(host, localState, remote);
    await settle();

    await ssh.vscode.commandHandlers.get(COMMANDS.switchProfile)?.('Work');
    await settle();
    const local = openWindow(host, localState);
    await settle();

    assert.deepEqual(Object.fromEntries(remote.settings), {
      'http.proxy': WORK.proxyUrl,
      'http.proxyStrictSSL': true,
      'http.noProxy': []
    });
    assert.equal(host.settings.has('http.proxy'), false);
    assert.equal(ssh.api.getState().currentProfile?.name, 'Work');
    assert.equal(ssh.api.getState().isEnabled, true);
    assert.equal(local.api.getState().currentProfile?.name, 'Home');
    assert.equal(local.api.getState().isEnabled, false);
  });

  it('pin an empty http.proxy when the proxy turns off in an SSH window', async () => {
    const host = createFakeHost({ 'proxyToggler.profiles': [WORK] });
    const remote = createFakeRemote('ssh-remote');
    const ssh = openWindow(host, new Map(), remote);
    await settle();

    await ssh.vscode.commandHandlers.get(COMMANDS.enable)?.();
    await settle();
    await ssh.vscode.commandHandlers.get(COMMANDS.disable)?.();
    await settle();

    // An empty value keeps this computer's proxy out of the remote side at start-up (TESTING.md,
    // "Remote windows", result 6).
    assert.deepEqual(Object.fromEntries(remote.settings), { 'http.proxy': '' });
    assert.equal(ssh.api.getState().isEnabled, false);
  });

  it("trust only the remote machine's own settings in an SSH window", async () => {
    // This computer's proxy is on, and VS Code hands it to the remote side at start-up.
    const host = createFakeHost({ 'proxyToggler.profiles': [WORK], ...APPLIED_WORK });
    const remote = createFakeRemote('ssh-remote');
    const ssh = openWindow(host, new Map(), remote, { remoteSeesLocalProxy: true });
    await settle();

    assert.equal(ssh.api.getState().isEnabled, false);
    assert.match(ssh.api.getStatusBarText() ?? '', /OFF/);
    assert.deepEqual(Object.fromEntries(remote.settings), {});
  });

  it("show the proxy on when the remote machine's own settings hold a profile", async () => {
    const host = createFakeHost({ 'proxyToggler.profiles': [WORK] });
    const remote = createFakeRemote('ssh-remote', APPLIED_WORK);
    const ssh = openWindow(host, new Map(), remote);
    await settle();

    assert.equal(ssh.api.getState().isEnabled, true);
    assert.equal(ssh.api.getState().currentProfile?.name, 'Work');
  });

  it("share a remote machine's record between the windows connected to it", async () => {
    const host = createFakeHost({ 'proxyToggler.profiles': [WORK, HOME] });
    const remote = createFakeRemote('ssh-remote');
    const first = openWindow(host, new Map(), remote);
    const second = openWindow(host, new Map(), remote, { focused: false });
    await settle();

    await first.vscode.commandHandlers.get(COMMANDS.switchProfile)?.('Home');
    await settle();

    assert.equal(second.api.getState().currentProfile?.name, 'Home');
    assert.equal(second.api.getState().isEnabled, true);
  });

  it("manage this computer's settings and record in a WSL window, and say so", async () => {
    const host = createFakeHost({ 'proxyToggler.profiles': [WORK] });
    const localState = new Map<string, unknown>();
    const remote = createFakeRemote('wsl');
    const wsl = openWindow(host, localState, remote);
    await settle();

    await wsl.vscode.commandHandlers.get(COMMANDS.enable)?.();
    await settle();
    const local = openWindow(host, localState);
    await settle();

    assert.equal(host.settings.get('http.proxy'), WORK.proxyUrl);
    assert.deepEqual(Object.fromEntries(remote.settings), {});
    assert.equal(local.api.getState().isEnabled, true);
    assert.equal(wsl.api.getStatusBarText(), '$(plug) Proxy: ON');
    assert.match(
      toggleOf(wsl.vscode).tooltip as string,
      /In this WSL window, Proxy Toggler manages this computer's proxy settings\./
    );
  });

  it('label the toggle with the SSH host it manages', async () => {
    const host = createFakeHost({ 'proxyToggler.profiles': [WORK, HOME] });
    const remote = createFakeRemote('ssh-remote', APPLIED_WORK);
    const ssh = openWindow(host, new Map(), remote);
    await settle();

    assert.equal(ssh.api.getStatusBarText(), `$(plug) Proxy (${os.hostname()}): Work`);
    assert.match(
      toggleOf(ssh.vscode).tooltip as string,
      new RegExp(`In this window, Proxy Toggler manages the proxy settings of ${os.hostname()}\\.`)
    );
    assert.match(ssh.api.getStatusBarAccessibilityLabel() ?? '', new RegExp(os.hostname()));
  });

  it('label the toggle with the remote type in a container that keeps its own proxy', async () => {
    const host = createFakeHost({ 'proxyToggler.profiles': [WORK] });
    const remote = createFakeRemote('dev-container', { 'http.useLocalProxyConfiguration': false });
    const container = openWindow(host, new Map(), remote);
    await settle();

    assert.equal(
      container.api.getStatusBarText(),
      '$(debug-disconnect) Proxy (Dev Container): OFF'
    );
  });

  it('follow a change of http.useLocalProxyConfiguration while the window is open', async () => {
    const host = createFakeHost({ 'proxyToggler.profiles': [WORK], ...APPLIED_WORK });
    const remote = createFakeRemote('wsl');
    const wsl = openWindow(host, new Map(), remote);
    await settle();
    const before = wsl.api.getStatusBarText();

    wsl.vscode.changeRemoteSettings({ 'http.useLocalProxyConfiguration': false });
    await settle();

    assert.equal(before, '$(plug) Proxy: ON');
    assert.equal(wsl.api.getStatusBarText(), '$(debug-disconnect) Proxy (WSL): OFF');
  });
});
