import { strict as assert } from 'node:assert';

import * as sinon from 'sinon';

import { createProxyToggler } from '../../src/proxy-toggler';
import { createFakeVscode } from '../support/fake-vscode';
import { createExtensionContext, flushBackgroundTasks } from '../support/fakes';

const SAVED_PROXY = {
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  noProxy: 'localhost'
};

const MIGRATED = {
  name: 'proxy.example.com',
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  bypassList: ['localhost']
};

const OTHER = {
  name: 'Other',
  proxyUrl: 'http://other.example.com:3128',
  strictSSL: true,
  bypassList: []
};

// Longer than any wait for the settings to settle.
const SETTLED = 10_000;

describe('migration from 0.1.x at activation', () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => clock.restore());

  function activate() {
    const vscode = createFakeVscode();
    const context = createExtensionContext({
      state: new Map([['proxyToggler.savedProxy', SAVED_PROXY]])
    });
    const api = createProxyToggler(vscode, context);
    return { vscode, context, api };
  }

  it('copies the 0.1.x configuration into a profile', async () => {
    const { vscode, api } = activate();

    await flushBackgroundTasks();

    assert.deepEqual(vscode.settings.get('proxyToggler.profiles'), [MIGRATED]);
    assert.match(api.getStatusBarText() ?? '', /proxy: off/i);
  });

  it('records the copy once a read after the settings settle still shows it', async () => {
    const { context } = activate();
    await flushBackgroundTasks();
    const markerBeforeSettling = context.globalState.store.get('proxyToggler.migratedProxy');

    await clock.tickAsync(SETTLED);
    await flushBackgroundTasks();

    assert.equal(markerBeforeSettling, undefined);
    assert.deepEqual(context.globalState.store.get('proxyToggler.migratedProxy'), {
      proxyUrl: MIGRATED.proxyUrl,
      strictSSL: MIGRATED.strictSSL,
      bypassList: MIGRATED.bypassList
    });
  });

  it('adds the copy again when another VS Code Profile migrating at the same time lost it', async () => {
    const { vscode } = activate();
    await flushBackgroundTasks();

    // Another window wrote the list as it read it before this copy landed.
    vscode.changeSettings({ 'proxyToggler.profiles': [OTHER] });
    await clock.tickAsync(SETTLED);
    await flushBackgroundTasks();

    assert.deepEqual(vscode.settings.get('proxyToggler.profiles'), [OTHER, MIGRATED]);
  });
});
