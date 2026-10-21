import { strict as assert } from 'node:assert';

import { COMMANDS } from '../../src/commands/command-ids';
import { createProxyToggler } from '../../src/proxy-toggler';
import { createFakeVscode } from '../support/fake-vscode';
import { createExtensionContext, flushBackgroundTasks } from '../support/fakes';

const WORK = {
  name: 'Work',
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  bypassList: []
};

const HOME = { ...WORK, name: 'Home', proxyUrl: 'http://home.example:3128' };

// Matches WORK: the credentials do not count.
const WITH_CREDENTIALS = {
  'http.proxy': 'http://alice:secret@proxy.example.com:8080',
  'http.proxyStrictSSL': true
};

function activate(state: Map<string, unknown>) {
  const vscode = createFakeVscode({
    settings: { 'proxyToggler.profiles': [WORK, HOME], ...WITH_CREDENTIALS }
  });
  createProxyToggler(vscode, createExtensionContext({ state }));
  return vscode;
}

describe('credentials in http.proxy', () => {
  it('are announced once, before the first write that removes them', async () => {
    const state = new Map<string, unknown>([
      ['proxyToggler.state', { isEnabled: true, currentProfile: WORK }]
    ]);
    const first = activate(state);
    await flushBackgroundTasks();

    await first.commandHandlers.get(COMMANDS.switchProfile)?.('Home');
    // Another write later, with credentials in http.proxy again.
    const later = activate(state);
    await flushBackgroundTasks();
    await later.commandHandlers.get(COMMANDS.disable)?.();

    const notices = [...first.messages, ...later.messages].filter(({ message }) =>
      message.includes('http.proxy')
    );
    assert.equal(notices.length, 1);
    // The key is a contract with installed copies (ARCHITECTURE.md, "Persisted data").
    assert.equal(state.get('proxyToggler.credentialsRemovalNoticeShown'), true);
    assert.equal(notices[0]?.kind, 'warning');
    assert.match(notices[0]?.message ?? '', /user name and password.*removed/);
    assert.match(notices[0]?.message ?? '', /VS Code's login dialog/);
    assert.match(notices[0]?.message ?? '', /plain http:\/\/ requests/);
    assert.doesNotMatch(notices[0]?.message ?? '', /alice|secret/);
    assert.equal(first.settings.get('http.proxy'), HOME.proxyUrl);
  });
});
