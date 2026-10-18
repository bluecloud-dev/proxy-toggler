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
    assert.equal(context.subscriptions.length, 7);
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

  it('writes http.noProxy as an array when the VS Code schema default is an array', async () => {
    const { vscode } = activateWith(
      { settingDefaults: { 'http.noProxy': [] } },
      {
        'proxyToggler.savedProxy': { ...SAVED_PROXY, noProxy: 'localhost,127.0.0.1' },
        'proxyToggler.state': { isEnabled: false, hasConfiguration: true }
      }
    );

    await vscode.commandHandlers.get(COMMANDS.enable)?.();

    assert.deepEqual(vscode.settings.get('http.noProxy'), ['localhost', '127.0.0.1']);
  });
});
