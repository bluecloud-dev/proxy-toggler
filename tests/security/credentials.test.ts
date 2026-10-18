import { strict as assert } from 'node:assert';

import { configureProxyCommand } from '../../src/commands/configure-proxy';
import { KeychainService } from '../../src/core/keychain-service';
import { ProxyManager } from '../../src/core/proxy-manager';
import { createFakeVscode } from '../support/fake-vscode';
import {
  createHttpSettings,
  createMemento,
  createNotificationRecorder,
  createSecretStorage
} from '../support/fakes';

const USERNAME = 'alice';
const PASSWORD = 'super-secret';

const SAVE_WITH_CREDENTIALS = {
  configuration: {
    proxyUrl: 'http://proxy.example.com:8080',
    strictSSL: true,
    noProxy: 'localhost'
  },
  credentials: { username: USERNAME, password: PASSWORD }
};

function createProxyManager(
  state = new Map<string, unknown>(),
  secrets = new Map<string, string>()
) {
  const globalState = createMemento(state);
  const proxyManager = new ProxyManager(
    globalState,
    new KeychainService(createSecretStorage(secrets)),
    createHttpSettings()
  );
  return { globalState, proxyManager };
}

describe('credential handling (security)', () => {
  it('never writes credentials to globalState', async () => {
    const { globalState, proxyManager } = createProxyManager();

    await proxyManager.saveConfiguration(SAVE_WITH_CREDENTIALS);

    const serializedState = JSON.stringify([...globalState.store.entries()]);
    assert.doesNotMatch(serializedState, new RegExp(USERNAME));
    assert.doesNotMatch(serializedState, new RegExp(PASSWORD));
  });

  it('reports that credentials exist without returning them', async () => {
    const { proxyManager } = createProxyManager();
    await proxyManager.saveConfiguration(SAVE_WITH_CREDENTIALS);

    const loaded = await proxyManager.loadConfiguration();

    assert.equal(loaded?.hasStoredCredentials, true);
    assert.doesNotMatch(JSON.stringify(loaded), new RegExp(`${USERNAME}|${PASSWORD}`));
  });

  it('keeps credentials across a restart', async () => {
    const state = new Map<string, unknown>();
    const secrets = new Map<string, string>();
    await createProxyManager(state, secrets).proxyManager.saveConfiguration(SAVE_WITH_CREDENTIALS);

    const afterRestart = await createProxyManager(state, secrets).proxyManager.loadConfiguration();

    assert.equal(afterRestart?.hasStoredCredentials, true);
  });

  it('never echoes credentials in user-facing messages', async () => {
    const vscode = createFakeVscode({
      inputs: ['http://proxy.example.com:8080', USERNAME, PASSWORD, ''],
      pick: (items) => items.find((item) => (item as { value?: boolean }).value === true)
    });
    const notifications = createNotificationRecorder();
    const proxyManager = {
      loadConfiguration: async () => undefined,
      saveConfiguration: async () => undefined
    };

    await configureProxyCommand(vscode, proxyManager, notifications, async () => undefined);

    const shown = [...notifications.notifications, ...vscode.messages];
    assert.ok(shown.length > 0);
    assert.doesNotMatch(JSON.stringify(shown), new RegExp(`${USERNAME}|${PASSWORD}`, 'i'));
  });
});
