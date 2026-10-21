import { strict as assert } from 'node:assert';
import * as os from 'node:os';

import type { QuickPickItem } from 'vscode';

import { COMMANDS } from '../../src/commands/command-ids';
import { createProxyToggler } from '../../src/proxy-toggler';
import {
  createFakeRemote,
  createFakeVscode,
  type FakeQuickPick,
  type FakeVscodeOptions
} from '../support/fake-vscode';
import { createExtensionContext } from '../support/fakes';
import { startTestProxy, type TestProxy } from '../support/test-proxy';

const chooseTest = (quickPick: FakeQuickPick): void => {
  quickPick.accept(
    quickPick.items.find((item: QuickPickItem) => item.label === 'Test Connection…')
  );
};

describe('Test Connection', () => {
  let proxy: TestProxy;
  beforeEach(async () => {
    proxy = await startTestProxy();
  });
  afterEach(() => proxy.close());

  function profile(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Work',
      proxyUrl: `http://127.0.0.1:${proxy.port}`,
      strictSSL: true,
      bypassList: [],
      ...overrides
    };
  }

  // Edits the current profile through Configure, picks Test Connection… once, then Escape.
  async function testFromEdit(target: string | undefined, options: FakeVscodeOptions = {}) {
    const state = new Map<string, unknown>();
    const prefilled: string[] = [];
    const vscode = createFakeVscode({
      ...options,
      settings: { 'proxyToggler.profiles': [profile()], ...options.settings },
      quickPick: (quickPick, index) => (index === 0 ? chooseTest(quickPick) : quickPick.dismiss()),
      inputBox: (box) => {
        prefilled.push(box.value);
        if (target === undefined) {
          box.dismiss();
        } else {
          box.submit(target);
        }
      }
    });
    createProxyToggler(vscode, createExtensionContext({ state }));
    await vscode.commandHandlers.get(COMMANDS.configure)?.();
    return { vscode, state, prefilled };
  }

  it('asks for a URL, prefilled with the Marketplace, and shows the result once', async () => {
    const { vscode, state, prefilled } = await testFromEdit('http://origin.test/');

    assert.deepEqual(prefilled, ['https://marketplace.visualstudio.com']);
    assert.deepEqual(
      vscode.messages.map(({ kind, message }) => [kind, message]),
      [['info', 'Work: The proxy fetched http://origin.test/, which answered 200.']]
    );
    // The URL is stored nowhere, and results are never logged.
    assert.doesNotMatch(JSON.stringify([...vscode.settings.entries()]), /origin\.test/);
    assert.doesNotMatch(JSON.stringify([...state.entries()]), /origin\.test/);
    assert.deepEqual(vscode.logs, []);
  });

  it('can be skipped', async () => {
    const { vscode } = await testFromEdit(undefined);

    assert.deepEqual(vscode.messages, []);
    assert.deepEqual(proxy.requests, []);
  });

  it('is skipped when both the window and extensions reach the target directly', async () => {
    const { vscode } = await testFromEdit('http://localhost:8080/');

    assert.deepEqual(proxy.requests, []);
    assert.match(vscode.messages[0]?.message ?? '', /Both VS Code's window and extensions reach/);
  });

  it('says which side reaches the target directly', async () => {
    const { vscode } = await testFromEdit('http://api.example.com/', {
      settings: { 'proxyToggler.profiles': [profile({ bypassList: ['*.example.com'] })] }
    });

    assert.equal(proxy.requests.length, 1);
    assert.match(
      vscode.messages[0]?.message ?? '',
      /VS Code's window reaches api\.example\.com directly, so only extensions use this proxy for it/
    );
  });

  it('notes that extensions ignore the proxy settings when http.proxySupport is off', async () => {
    const { vscode } = await testFromEdit('http://origin.test/', {
      settings: { 'http.proxySupport': 'off' }
    });

    assert.match(vscode.messages[0]?.message ?? '', /http\.proxySupport is "off"/);
  });

  it('shows a failure as an error', async () => {
    const closed = await startTestProxy();
    await closed.close();

    const { vscode } = await testFromEdit('http://origin.test/', {
      settings: {
        'proxyToggler.profiles': [profile({ proxyUrl: `http://127.0.0.1:${closed.port}` })]
      }
    });

    assert.equal(vscode.messages[0]?.kind, 'error');
    assert.match(vscode.messages[0]?.message ?? '', /Could not reach the proxy/);
  });

  it('says it covers only HTTP and HTTPS proxies for a SOCKS profile, without asking for a URL', async () => {
    const { vscode } = await testFromEdit('http://origin.test/', {
      settings: { 'proxyToggler.profiles': [profile({ proxyUrl: 'socks5://127.0.0.1:1080' })] }
    });

    assert.equal(vscode.inputBoxes.length, 0);
    assert.match(vscode.messages[0]?.message ?? '', /only HTTP and HTTPS proxies/);
  });

  it('says where it ran in an SSH window, where the VS Code window does not use the profile', async () => {
    const { vscode } = await testFromEdit('http://api.example.com/', {
      remote: createFakeRemote('ssh-remote'),
      settings: { 'proxyToggler.profiles': [profile({ bypassList: ['*.example.com'] })] }
    });

    assert.deepEqual(
      vscode.messages.map(({ message }) => message),
      [
        `Work: The proxy fetched http://api.example.com/, which answered 200. Tested from ${os.hostname()}.`
      ]
    );
  });

  it("says that the VS Code window was not tested where a remote uses this computer's settings", async () => {
    const { vscode } = await testFromEdit('http://origin.test/', {
      remote: createFakeRemote('wsl')
    });

    assert.deepEqual(
      vscode.messages.map(({ message }) => message),
      [
        "Work: The proxy fetched http://origin.test/, which answered 200. Tested from WSL. VS Code's window connects from this computer and was not tested."
      ]
    );
  });
});
