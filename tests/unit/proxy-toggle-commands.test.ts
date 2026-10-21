import { strict as assert } from 'node:assert';

import { disableProxyCommand } from '../../src/commands/disable-proxy';
import { enableProxyCommand } from '../../src/commands/enable-proxy';
import { toggleProxyCommand } from '../../src/commands/toggle-proxy';
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
      hasConfiguration: options.hasConfiguration,
      currentProfile: {
        name: 'Work',
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        bypassList: []
      }
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

  it('enable turns the proxy on and refreshes the UI, saying nothing', async () => {
    const proxyManager = createProxyManagerStub({ hasConfiguration: true });
    const notifications = createNotificationRecorder();
    let refreshes = 0;

    await enableProxyCommand(createFakeVscode(), proxyManager, notifications, async () => {
      refreshes += 1;
    });

    assert.deepEqual(notifications.notifications, []);
    assert.equal(proxyManager.calls.enable, 1);
    assert.equal(refreshes, 1);
  });

  it('disable turns the proxy off and refreshes the UI, saying nothing', async () => {
    const proxyManager = createProxyManagerStub({ hasConfiguration: false });
    const notifications = createNotificationRecorder();
    let refreshes = 0;

    await disableProxyCommand(createFakeVscode(), proxyManager, notifications, async () => {
      refreshes += 1;
    });

    assert.equal(proxyManager.calls.disable, 1);
    assert.deepEqual(notifications.notifications, []);
    assert.equal(refreshes, 1);
  });

  for (const [name, run, toggleResult, message] of [
    ['enable', enableProxyCommand, true, 'Proxy Toggler turned on Work.'],
    ['disable', disableProxyCommand, false, 'Proxy Toggler turned off Work.'],
    ['toggle', toggleProxyCommand, true, 'Proxy Toggler turned on Work.']
  ] as const) {
    it(`${name} names the profile in a toast without buttons when showSwitchNotifications is on`, async () => {
      const vscode = createFakeVscode({
        settings: { 'proxyToggler.showSwitchNotifications': true }
      });
      const notifications = createNotificationRecorder();

      await run(
        vscode,
        createProxyManagerStub({ hasConfiguration: true, toggleResult }),
        notifications,
        noRefresh
      );

      assert.deepEqual(notifications.notifications, [{ kind: 'success', message, actions: [] }]);
    });
  }

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

    assert.equal(proxyManager.calls.enable, 1);
    assert.deepEqual(
      notifications.notifications.map(({ message, actions }) => [
        message,
        actions.map((action) => action.title)
      ]),
      [['Turn proxy on?', ['Turn On', 'Cancel']]]
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
