import { strict as assert } from 'node:assert';

import { createProxyToggler } from '../../src/proxy-toggler';
import { createFakeVscode } from '../support/fake-vscode';
import { createExtensionContext, flushBackgroundTasks } from '../support/fakes';

// The keys 0.1.x stored a proxy username and password under; no version ever applied them.
const USERNAME_KEY = 'proxyToggler.credentials.username';
const PASSWORD_KEY = 'proxyToggler.credentials.password';

describe('0.1.x stored credentials', () => {
  it('are deleted at activation', async () => {
    const secrets = new Map([
      [USERNAME_KEY, 'alice'],
      [PASSWORD_KEY, 'secret']
    ]);

    createProxyToggler(createFakeVscode(), createExtensionContext({ secrets }));
    await flushBackgroundTasks();

    assert.deepEqual([...secrets.keys()], []);
  });

  it('are announced once, and only when one was found', async () => {
    const state = new Map<string, unknown>();
    const secrets = new Map([[USERNAME_KEY, 'alice']]);

    const first = createFakeVscode();
    createProxyToggler(first, createExtensionContext({ state, secrets }));
    await flushBackgroundTasks();
    // The next activation in the same VS Code Profile finds nothing left to remove.
    const second = createFakeVscode();
    createProxyToggler(second, createExtensionContext({ state, secrets }));
    await flushBackgroundTasks();

    assert.deepEqual(
      first.messages.map((message) => message.kind),
      ['info']
    );
    assert.match(first.messages[0]?.message ?? '', /removed the proxy username and password/);
    assert.match(first.messages[0]?.message ?? '', /VS Code shows its own login dialog/);
    assert.deepEqual(second.messages, []);
  });

  it('are announced in the next focused window', async () => {
    const state = new Map<string, unknown>();
    const vscode = createFakeVscode({ focused: false });
    createProxyToggler(
      vscode,
      createExtensionContext({ state, secrets: new Map([[PASSWORD_KEY, 'secret']]) })
    );
    await flushBackgroundTasks();
    const beforeFocus = vscode.messages.length;
    // The key is a contract with installed copies (ARCHITECTURE.md, "Persisted data").
    const pending = state.get('proxyToggler.credentialsNoticePending');

    vscode.setFocused(true);
    await flushBackgroundTasks();

    assert.equal(beforeFocus, 0);
    assert.equal(pending, true);
    assert.deepEqual(
      vscode.messages.map((message) => message.kind),
      ['info']
    );
  });

  it('are deleted at a later activation when deleting them fails', async () => {
    const state = new Map<string, unknown>();
    const secrets = new Map([
      [USERNAME_KEY, 'alice'],
      [PASSWORD_KEY, 'secret']
    ]);

    const failing = createFakeVscode();
    createProxyToggler(
      failing,
      createExtensionContext({
        state,
        secrets,
        secretFailures: { delete: new Error('Keychain is locked') }
      })
    );
    await flushBackgroundTasks();
    const secretsAfterFailure = secrets.size;
    const retrying = createFakeVscode();
    createProxyToggler(retrying, createExtensionContext({ state, secrets }));
    await flushBackgroundTasks();

    assert.equal(secretsAfterFailure, 2);
    assert.deepEqual(failing.messages, []);
    assert.match(failing.logs.join('\n'), /Stored credentials removal failed/);
    assert.equal(secrets.size, 0);
    assert.deepEqual(
      retrying.messages.map((message) => message.kind),
      ['info']
    );
  });
});
