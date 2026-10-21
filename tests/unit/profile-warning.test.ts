import { strict as assert } from 'node:assert';

import { createProxyToggler } from '../../src/proxy-toggler';
import { createFakeVscode, type FakeVscodeOptions } from '../support/fake-vscode';
import { createExtensionContext, flushBackgroundTasks } from '../support/fakes';

const WORK = {
  name: 'Work',
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  bypassList: []
};

const BROKEN = { name: 'Broken', proxyUrl: 'proxy.example.com' };

const FLAGGED = { 'proxyToggler.profiles': [WORK, BROKEN, { ...WORK, name: 'work' }] };

function activate(options: FakeVscodeOptions, state = new Map<string, unknown>()) {
  const vscode = createFakeVscode(options);
  createProxyToggler(vscode, createExtensionContext({ state }));
  return vscode;
}

const warnings = (vscode: ReturnType<typeof createFakeVscode>) =>
  vscode.messages.filter((message) => message.kind === 'warning');

describe('hidden profile entries', () => {
  it('are named in one warning with an Open Settings action', async () => {
    const vscode = activate({ settings: FLAGGED });
    await flushBackgroundTasks();

    const [warning, ...others] = warnings(vscode);

    assert.equal(others.length, 0);
    assert.match(warning?.message ?? '', /"Broken" has an invalid proxy URL/);
    assert.match(warning?.message ?? '', /"work" repeats the name of an earlier entry/);
    assert.deepEqual(warning?.items, ['Open Settings']);
  });

  it('are not warned about again after a reload while they stay the same', async () => {
    const state = new Map<string, unknown>();
    activate({ settings: FLAGGED }, state);
    await flushBackgroundTasks();

    const reloaded = activate({ settings: FLAGGED }, state);
    await flushBackgroundTasks();

    assert.deepEqual(warnings(reloaded), []);
    // The key is a contract with installed copies (ARCHITECTURE.md, "Persisted data"), and holds
    // a SHA-256 hash, never the entries.
    assert.match(String(state.get('proxyToggler.hiddenProfilesWarned')), /^[0-9a-f]{64}$/);
  });

  it('are warned about again when they change', async () => {
    const vscode = activate({ settings: FLAGGED });
    await flushBackgroundTasks();

    vscode.changeSettings({ 'proxyToggler.profiles': [WORK, { name: 'Other' }] });
    await flushBackgroundTasks();

    assert.equal(warnings(vscode).length, 2);
    assert.match(warnings(vscode)[1]?.message ?? '', /"Other" has no proxy URL/);
  });

  it('are warned about again when they come back after a fix', async () => {
    const vscode = activate({ settings: FLAGGED });
    await flushBackgroundTasks();

    vscode.changeSettings({ 'proxyToggler.profiles': [WORK] });
    await flushBackgroundTasks();
    vscode.changeSettings(FLAGGED);
    await flushBackgroundTasks();

    assert.equal(warnings(vscode).length, 2);
  });

  it('open the application settings file from the warning', async () => {
    const vscode = activate({ settings: FLAGGED, answer: () => 'Open Settings' });
    await flushBackgroundTasks();

    assert.ok(
      vscode.executedCommands.some(
        ({ command }) => command === 'workbench.action.openApplicationSettingsJson'
      )
    );
  });

  it('are warned about in the next focused window', async () => {
    const vscode = activate({ settings: FLAGGED, focused: false });
    await flushBackgroundTasks();
    const beforeFocus = warnings(vscode).length;

    vscode.setFocused(true);
    await flushBackgroundTasks();

    assert.equal(beforeFocus, 0);
    assert.equal(warnings(vscode).length, 1);
  });

  it('never keep credentials, even in what Proxy Toggler remembers about the warning', async () => {
    const withCredentials = { name: 'Leaky', proxyUrl: 'http://alice:secret@proxy.example.com:1' };
    const state = new Map<string, unknown>();
    const vscode = activate({ settings: { 'proxyToggler.profiles': [withCredentials] } }, state);
    await flushBackgroundTasks();

    assert.doesNotMatch(JSON.stringify([...state.entries()]), /secret/);
    assert.doesNotMatch(warnings(vscode)[0]?.message ?? '', /secret/);
  });
});
