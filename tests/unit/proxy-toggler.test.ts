import { strict as assert } from 'node:assert';

import { COMMANDS } from '../../src/commands/command-ids';
import { createProxyToggler } from '../../src/proxy-toggler';
import { createFakeVscode, type FakeVscodeOptions } from '../support/fake-vscode';
import { createExtensionContext, flushBackgroundTasks } from '../support/fakes';

const SAVED_PROXY = {
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  noProxy: 'localhost'
};

const APPLIED_SETTINGS = {
  'http.proxy': 'http://proxy.example.com:8080',
  'http.proxyStrictSSL': true,
  'http.noProxy': 'localhost'
};

function activateWith(options: FakeVscodeOptions, state?: Record<string, unknown>) {
  const vscode = createFakeVscode(options);
  const context = createExtensionContext({ state: new Map(Object.entries(state ?? {})) });
  const api = createProxyToggler(vscode, context);
  return { vscode, context, api };
}

describe('createProxyToggler', () => {
  it('registers every command and owns its disposables', () => {
    const { vscode, context } = activateWith({});

    assert.deepEqual(
      [...vscode.commandHandlers.keys()],
      [COMMANDS.configure, COMMANDS.enable, COMMANDS.disable, COMMANDS.toggle]
    );
    assert.equal(context.subscriptions.length, 6);
  });

  it('runs every command without a saved configuration', async () => {
    const { vscode } = activateWith({});

    for (const command of Object.values(COMMANDS)) {
      await vscode.commandHandlers.get(command)?.();
    }

    assert.deepEqual(
      vscode.messages.map((message) => message.kind),
      ['warning', 'info', 'warning']
    );
  });

  it('syncs the stored state when the user accepts the drift prompt', async () => {
    const { vscode, api } = activateWith(
      { settings: APPLIED_SETTINGS, answer: () => 'Sync' },
      {
        'proxyToggler.savedProxy': SAVED_PROXY,
        'proxyToggler.state': { isEnabled: false, hasConfiguration: true }
      }
    );

    await flushBackgroundTasks();

    assert.deepEqual(
      vscode.messages.map((message) => message.message),
      ['VS Code proxy settings differ from Proxy Toggler state.']
    );
    assert.equal(api.getState().isEnabled, true);
  });

  it('does not check drift without a saved configuration', async () => {
    const { vscode } = activateWith({ settings: APPLIED_SETTINGS });

    await flushBackgroundTasks();

    assert.deepEqual(vscode.messages, []);
  });

  it('does not prompt when the stored state matches the settings', async () => {
    const { vscode } = activateWith(
      { settings: APPLIED_SETTINGS },
      {
        'proxyToggler.savedProxy': SAVED_PROXY,
        'proxyToggler.state': { isEnabled: true, hasConfiguration: true }
      }
    );

    await flushBackgroundTasks();

    assert.deepEqual(vscode.messages, []);
  });

  it('treats an array-valued http.noProxy like the saved comma-separated list', async () => {
    const { vscode } = activateWith(
      { settings: { ...APPLIED_SETTINGS, 'http.noProxy': ['localhost'] } },
      {
        'proxyToggler.savedProxy': SAVED_PROXY,
        'proxyToggler.state': { isEnabled: true, hasConfiguration: true }
      }
    );

    await flushBackgroundTasks();

    assert.deepEqual(vscode.messages, []);
  });

  it('writes http.noProxy as an array', async () => {
    const { vscode } = activateWith(
      {},
      {
        'proxyToggler.savedProxy': { ...SAVED_PROXY, noProxy: 'localhost,127.0.0.1' },
        'proxyToggler.state': { isEnabled: false, hasConfiguration: true }
      }
    );

    await vscode.commandHandlers.get(COMMANDS.enable)?.();

    assert.deepEqual(vscode.settings.get('http.noProxy'), ['localhost', '127.0.0.1']);
  });

  it('shows the keychain message and logs when the keychain cannot be read', async () => {
    const vscode = createFakeVscode();
    const context = createExtensionContext({
      state: new Map<string, unknown>([['proxyToggler.savedProxy', SAVED_PROXY]]),
      secretFailures: { get: new Error('Keychain is locked') }
    });
    createProxyToggler(vscode, context);

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.deepEqual(
      vscode.messages.map((message) => [message.kind, message.message]),
      [['error', 'Your system keychain appears to be locked. Unlock it and try again.']]
    );
    assert.match(vscode.logs.join('\n'), /proxyToggler\.configure failed/);
  });

  it('logs an unexpected failure and shows the command failure message', async () => {
    const { vscode } = activateWith({});
    vscode.window.showInputBox = async () => {
      throw new Error('input box failed');
    };

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.deepEqual(
      vscode.messages.map((message) => [message.kind, message.message]),
      [['error', 'Failed to configure proxy.']]
    );
    assert.match(vscode.logs.join('\n'), /input box failed/);
  });

  it('logs failed background work instead of dropping it', async () => {
    const vscode = createFakeVscode();
    vscode.commands.executeCommand = async () => {
      throw new Error('setContext failed');
    };

    createProxyToggler(vscode, createExtensionContext());
    await flushBackgroundTasks();

    assert.match(vscode.logs.join('\n'), /Status bar refresh failed.*setContext failed/);
  });
});
