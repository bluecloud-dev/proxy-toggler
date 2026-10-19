import { strict as assert } from 'node:assert';

import type { QuickPickItem } from 'vscode';

import { configureProxyCommand } from '../../src/commands/configure-proxy';
import { KeychainError, KeychainErrorReason } from '../../src/core/keychain-service';
import type { ProxyConfiguration } from '../../src/core/proxy-configuration';
import type { CredentialsUpdate, LoadedProxyConfiguration } from '../../src/core/proxy-manager';
import { ValidationError } from '../../src/core/validation';
import { createFakeVscode } from '../support/fake-vscode';
import { createNotificationRecorder } from '../support/fakes';

const PROXY_URL = 'http://proxy.example.com:8080';

type Pick = (items: readonly QuickPickItem[]) => QuickPickItem | undefined;

type Scenario = {
  inputs: Array<string | undefined>;
  // In order: the stored-credentials action (asked only when credentials exist), then strict SSL.
  picks: Pick[];
  existing?: LoadedProxyConfiguration;
  saveError?: Error;
  notificationAnswer?: string;
};

const strictSSL =
  (value: boolean): Pick =>
  (items) =>
    items.find((item) => (item as { value?: boolean }).value === value);

const itemAt =
  (index: number): Pick =>
  (items) =>
    items[index];

const storedCredentials: LoadedProxyConfiguration = {
  proxyUrl: PROXY_URL,
  strictSSL: true,
  noProxy: 'localhost',
  hasStoredCredentials: true
};

async function runConfigure(scenario: Scenario) {
  const saveCalls: Array<{ configuration: ProxyConfiguration; credentials: CredentialsUpdate }> =
    [];
  let refreshes = 0;
  const vscode = createFakeVscode({
    inputs: scenario.inputs,
    pick: (items, index) => scenario.picks[index]?.(items)
  });
  const notifications = createNotificationRecorder(() => scenario.notificationAnswer);
  const proxyManager = {
    loadConfiguration: async () => scenario.existing,
    saveConfiguration: async (
      configuration: ProxyConfiguration,
      credentials: CredentialsUpdate
    ) => {
      if (scenario.saveError) {
        throw scenario.saveError;
      }
      saveCalls.push({ configuration, credentials });
    }
  };

  await configureProxyCommand(vscode, proxyManager, notifications, async () => {
    refreshes += 1;
  });

  return {
    saveCalls,
    refreshes,
    notifications: notifications.notifications,
    executed: vscode.executedCommands.map((call) => call.command)
  };
}

describe('configureProxyCommand', () => {
  it('saves without credentials when the username is left empty', async () => {
    const result = await runConfigure({ inputs: [PROXY_URL, '', ''], picks: [strictSSL(true)] });

    assert.deepEqual(result.saveCalls, [
      {
        configuration: { proxyUrl: PROXY_URL, strictSSL: true, noProxy: '' },
        credentials: { mode: 'keep' }
      }
    ]);
    assert.deepEqual(
      result.notifications.map((notification) => notification.message),
      ['Proxy configuration saved. Enable now?']
    );
    assert.deepEqual(result.executed, []);
    assert.equal(result.refreshes, 1);
  });

  it('saves credentials when both are entered', async () => {
    const result = await runConfigure({
      inputs: [PROXY_URL, 'alice', 'secret', ''],
      picks: [strictSSL(true)]
    });

    assert.deepEqual(result.saveCalls, [
      {
        configuration: { proxyUrl: PROXY_URL, strictSSL: true, noProxy: '' },
        credentials: { mode: 'set', credentials: { username: 'alice', password: 'secret' } }
      }
    ]);
    assert.equal(result.refreshes, 1);
  });

  it('keeps stored credentials without reading them', async () => {
    const result = await runConfigure({
      existing: storedCredentials,
      inputs: [PROXY_URL, 'localhost'],
      picks: [itemAt(0), strictSSL(false)]
    });

    assert.deepEqual(result.saveCalls, [
      {
        configuration: { proxyUrl: PROXY_URL, strictSSL: false, noProxy: 'localhost' },
        credentials: { mode: 'keep' }
      }
    ]);
  });

  it('removes stored credentials', async () => {
    const result = await runConfigure({
      existing: storedCredentials,
      inputs: [PROXY_URL, 'localhost'],
      picks: [itemAt(2), strictSSL(true)]
    });

    assert.deepEqual(result.saveCalls, [
      {
        configuration: { proxyUrl: PROXY_URL, strictSSL: true, noProxy: 'localhost' },
        credentials: { mode: 'clear' }
      }
    ]);
  });

  it('replaces stored credentials', async () => {
    const result = await runConfigure({
      existing: storedCredentials,
      inputs: [PROXY_URL, 'bob', 'secret', 'localhost'],
      picks: [itemAt(1), strictSSL(true)]
    });

    assert.deepEqual(result.saveCalls, [
      {
        configuration: { proxyUrl: PROXY_URL, strictSSL: true, noProxy: 'localhost' },
        credentials: { mode: 'set', credentials: { username: 'bob', password: 'secret' } }
      }
    ]);
  });

  it('enables the proxy when the user accepts the follow-up prompt', async () => {
    const result = await runConfigure({
      inputs: [PROXY_URL, '', 'localhost'],
      picks: [strictSSL(true)],
      notificationAnswer: 'enable'
    });

    assert.deepEqual(result.executed, ['proxyToggler.enable']);
    assert.equal(result.refreshes, 1);
  });

  it('shows keychain errors without leaking secrets', async () => {
    const result = await runConfigure({
      inputs: [PROXY_URL, '', 'localhost'],
      picks: [strictSSL(true)],
      saveError: new KeychainError('store', KeychainErrorReason.PERMISSION_DENIED)
    });

    const [error] = result.notifications;
    assert.equal(result.notifications.length, 1);
    assert.equal(error?.kind, 'error');
    assert.match(error?.message ?? '', /permission/i);
    assert.doesNotMatch(error?.message ?? '', /secret/i);
    assert.equal(result.refreshes, 0);
  });

  it('shows validation errors with examples', async () => {
    const result = await runConfigure({
      inputs: [PROXY_URL, '', 'localhost'],
      picks: [strictSSL(true)],
      saveError: new ValidationError('proxyUrl', 'URL is required', [PROXY_URL])
    });

    const [error] = result.notifications;
    assert.equal(result.notifications.length, 1);
    assert.match(error?.message ?? '', /invalid proxyurl/i);
    assert.match(error?.message ?? '', /examples/i);
    assert.equal(result.refreshes, 0);
  });

  it('rethrows save errors it cannot explain', async () => {
    await assert.rejects(
      runConfigure({
        inputs: [PROXY_URL, '', 'localhost'],
        picks: [strictSSL(true)],
        saveError: new Error('disk full')
      }),
      /disk full/
    );
  });
});
