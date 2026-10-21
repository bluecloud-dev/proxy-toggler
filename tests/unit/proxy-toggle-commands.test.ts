import { strict as assert } from 'node:assert';

import { disableProxyCommand } from '../../src/commands/disable-proxy';
import { enableProxyCommand } from '../../src/commands/enable-proxy';
import { toggleProxyCommand } from '../../src/commands/toggle-proxy';
import { KeychainError, KeychainErrorReason } from '../../src/core/keychain-service';
import { ConfigurationError } from '../../src/core/proxy-settings-writer';
import { createFakeVscode } from '../support/fake-vscode';
import { createNotificationRecorder, type RecordedNotification } from '../support/fakes';

type ProxyManagerStub = ReturnType<typeof createProxyManagerStub>;

const noRefresh = async (): Promise<void> => undefined;

function answer(kind: RecordedNotification['kind'], actionId: string) {
  return (notification: RecordedNotification): string | undefined =>
    notification.kind === kind ? actionId : undefined;
}

function createProxyManagerStub(options: {
  hasConfiguration: boolean;
  isEnabled?: boolean;
  toggleResult?: boolean;
}) {
  const calls = { enable: 0, disable: 0, toggle: 0 };
  return {
    calls,
    hasConfiguration: () => options.hasConfiguration,
    getState: () => ({
      isEnabled: options.isEnabled ?? false,
      hasConfiguration: options.hasConfiguration
    }),
    enableProxy: async (): Promise<void> => {
      calls.enable += 1;
    },
    disableProxy: async (): Promise<void> => {
      calls.disable += 1;
    },
    toggleProxy: async (): Promise<boolean> => {
      calls.toggle += 1;
      return options.toggleResult ?? !options.isEnabled;
    }
  };
}

function failWith(proxyManager: ProxyManagerStub, error: Error): ProxyManagerStub {
  const fail = async (): Promise<never> => {
    throw error;
  };
  return { ...proxyManager, enableProxy: fail, disableProxy: fail, toggleProxy: fail };
}

describe('proxy state commands', () => {
  it('enable offers to configure when nothing is saved', async () => {
    const vscode = createFakeVscode();
    const notifications = createNotificationRecorder(answer('warning', 'configure'));

    await enableProxyCommand(
      vscode,
      createProxyManagerStub({ hasConfiguration: false }),
      notifications,
      noRefresh
    );

    assert.equal(notifications.notifications.length, 1);
    assert.deepEqual(
      vscode.executedCommands.map((call) => call.command),
      ['proxyToggler.configure']
    );
  });

  it('enable applies the proxy, refreshes the UI, and reports success', async () => {
    const proxyManager = createProxyManagerStub({ hasConfiguration: true });
    const notifications = createNotificationRecorder();
    let refreshes = 0;

    await enableProxyCommand(createFakeVscode(), proxyManager, notifications, async () => {
      refreshes += 1;
    });

    assert.deepEqual(
      notifications.notifications.map((notification) => notification.message),
      ['Proxy enabled']
    );
    assert.equal(proxyManager.calls.enable, 1);
    assert.equal(refreshes, 1);
  });

  it('disable clears the proxy, refreshes the UI, and reports success', async () => {
    const proxyManager = createProxyManagerStub({ hasConfiguration: false });
    const notifications = createNotificationRecorder();
    let refreshes = 0;

    await disableProxyCommand(createFakeVscode(), proxyManager, notifications, async () => {
      refreshes += 1;
    });

    assert.equal(proxyManager.calls.disable, 1);
    assert.deepEqual(
      notifications.notifications.map((notification) => notification.message),
      ['Proxy disabled']
    );
    assert.equal(refreshes, 1);
  });

  it('toggle asks for confirmation when enabled and stops on cancel', async () => {
    const vscode = createFakeVscode({ settings: { 'proxyToggler.confirmBeforeToggle': true } });
    const proxyManager = createProxyManagerStub({ hasConfiguration: true, isEnabled: true });
    const notifications = createNotificationRecorder(answer('warning', 'cancel'));

    await toggleProxyCommand(vscode, proxyManager, notifications, noRefresh);

    assert.deepEqual(
      notifications.notifications.map((notification) => notification.kind),
      ['warning']
    );
    assert.equal(proxyManager.calls.toggle, 0);
  });

  it('toggle proceeds when the confirmation is accepted', async () => {
    const vscode = createFakeVscode({ settings: { 'proxyToggler.confirmBeforeToggle': true } });
    const proxyManager = createProxyManagerStub({
      hasConfiguration: true,
      isEnabled: false,
      toggleResult: true
    });
    const notifications = createNotificationRecorder(answer('warning', 'confirm'));

    await toggleProxyCommand(vscode, proxyManager, notifications, noRefresh);

    assert.equal(proxyManager.calls.toggle, 1);
    assert.deepEqual(
      notifications.notifications.map((notification) => notification.message),
      ['Enable proxy?', 'Proxy enabled']
    );
  });

  it('toggle offers to configure when nothing is saved', async () => {
    const vscode = createFakeVscode();

    await toggleProxyCommand(
      vscode,
      createProxyManagerStub({ hasConfiguration: false }),
      createNotificationRecorder(answer('warning', 'configure')),
      noRefresh
    );

    assert.deepEqual(
      vscode.executedCommands.map((call) => call.command),
      ['proxyToggler.configure']
    );
  });

  it('shows the keychain message when the keychain fails', async () => {
    const notifications = createNotificationRecorder();
    const proxyManager = failWith(
      createProxyManagerStub({ hasConfiguration: true }),
      new KeychainError('retrieve', KeychainErrorReason.LOCKED)
    );

    await enableProxyCommand(createFakeVscode(), proxyManager, notifications, noRefresh);

    assert.equal(notifications.notifications.length, 1);
    assert.match(notifications.notifications[0]?.message ?? '', /locked/i);
  });

  const settingFailures = [
    { name: 'enable', run: enableProxyCommand, error: new ConfigurationError('enable', 'proxy') },
    {
      name: 'disable',
      run: disableProxyCommand,
      error: new ConfigurationError('disable', 'noProxy')
    },
    {
      name: 'toggle',
      run: toggleProxyCommand,
      error: new ConfigurationError('enable', 'proxyStrictSSL')
    }
  ];

  for (const { name, run, error } of settingFailures) {
    it(`${name} offers to open the setting that could not be updated`, async () => {
      const vscode = createFakeVscode();
      const notifications = createNotificationRecorder(answer('error', 'openSettings'));
      const proxyManager = failWith(createProxyManagerStub({ hasConfiguration: true }), error);

      await run(vscode, proxyManager, notifications, noRefresh);

      assert.ok(notifications.notifications[0]?.actions.some((a) => a.id === 'openSettings'));
      assert.deepEqual(vscode.executedCommands, [
        { command: 'workbench.action.openSettings', args: [error.getSettingId()] }
      ]);
    });
  }

  for (const [name, run] of [
    ['enable', enableProxyCommand],
    ['toggle', toggleProxyCommand]
  ] as const) {
    it(`${name} offers "Disable Proxy" after enabling`, async () => {
      const vscode = createFakeVscode();
      const proxyManager = createProxyManagerStub({
        hasConfiguration: true,
        isEnabled: false,
        toggleResult: true
      });
      const notifications = createNotificationRecorder(answer('success', 'disableProxy'));

      await run(vscode, proxyManager, notifications, noRefresh);

      assert.deepEqual(
        vscode.executedCommands.map((call) => call.command),
        ['proxyToggler.disable']
      );
    });
  }

  it('rethrows errors it cannot explain, for the command registrar to report', async () => {
    const proxyManager = failWith(
      createProxyManagerStub({ hasConfiguration: true }),
      new Error('unexpected')
    );

    await assert.rejects(
      enableProxyCommand(createFakeVscode(), proxyManager, createNotificationRecorder(), noRefresh),
      /unexpected/
    );
  });
});
