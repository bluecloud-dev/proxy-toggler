import { strict as assert } from 'node:assert';

import { COMMANDS } from '../../src/commands/command-ids';
import { createProxyToggler } from '../../src/proxy-toggler';
import { createFakeVscode, type FakeVscodeOptions } from '../support/fake-vscode';
import { createExtensionContext } from '../support/fakes';

const USERNAME = 'alice';
const PASSWORD = 'super-secret';
const CREDENTIALS = new RegExp(`${USERNAME}|${PASSWORD}`, 'i');
const PROXY_WITH_CREDENTIALS = `http://${USERNAME}:${PASSWORD}@proxy.example.com:8080`;

function activate(options: FakeVscodeOptions) {
  const vscode = createFakeVscode(options);
  const state = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  createProxyToggler(vscode, createExtensionContext({ state, secrets }));
  return { vscode, state, secrets };
}

// Profiles hold no credentials (ADR 0003), so none may reach anything Proxy Toggler keeps or shows.
describe('credential handling (security)', () => {
  it('never copies credentials from http.proxy into what it keeps or shows', async () => {
    const { vscode, state, secrets } = activate({
      settings: { 'http.proxy': PROXY_WITH_CREDENTIALS, 'http.noProxy': ['10.0.0.0/8'] },
      answer: ({ kind }) => (kind === 'warning' ? 'Continue Without Them' : undefined),
      inputBox: (box) => box.submit()
    });

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.ok(Array.isArray(vscode.settings.get('proxyToggler.profiles')));
    for (const kept of [
      vscode.settings.get('proxyToggler.profiles'),
      [...state.entries()],
      [...secrets.entries()],
      vscode.messages,
      vscode.logs,
      vscode.inputBoxes.map((box) => box.value)
    ]) {
      assert.doesNotMatch(JSON.stringify(kept), CREDENTIALS);
    }
  });

  it('refuses a proxy URL with credentials without repeating them', async () => {
    const problems: unknown[] = [];
    const { vscode } = activate({
      inputBox: (box, index) => {
        if (index === 0) {
          box.submit(PROXY_WITH_CREDENTIALS);
          problems.push(box.validationMessage);
        }
        box.dismiss();
      }
    });

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.match(String(problems[0]), /credentials/i);
    assert.doesNotMatch(String(problems[0]), CREDENTIALS);
    assert.equal(vscode.settings.has('proxyToggler.profiles'), false);
  });

  it('keeps credentials out of the log when a command fails', async () => {
    const vscode = createFakeVscode({ settings: { 'http.proxy': PROXY_WITH_CREDENTIALS } });
    vscode.window.createInputBox = () => {
      throw new Error('input box failed');
    };
    createProxyToggler(vscode, createExtensionContext());

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    const log = vscode.logs.join('\n');
    assert.match(log, /input box failed/);
    assert.doesNotMatch(log, CREDENTIALS);
  });
});
