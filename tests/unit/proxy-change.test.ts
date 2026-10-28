import { strict as assert } from 'node:assert';

import { createProxyChange } from '../../src/commands/proxy-change';
import type { Profile } from '../../src/core/profiles';
import { ProfileApplyError, ProxyManager } from '../../src/core/proxy-manager';
import type { ProxyOutcome } from '../../src/core/proxy-outcome';
import { ConfigurationError } from '../../src/core/proxy-settings-writer';
import { createFakeVscode } from '../support/fake-vscode';
import {
  createHttpSettings,
  createMemento,
  createNotificationRecorder,
  createProfilesSetting,
  type RecordedNotification
} from '../support/fakes';

const WORK: Profile = {
  name: 'Work',
  proxyUrl: 'http://work.example.com:8080',
  strictSSL: true,
  bypassList: []
};
const OFFICE: Profile = { ...WORK, name: 'Office' };

// The changes these tests pass ignore the manager; the module only hands it to them.
function setup(
  options: {
    toasts?: boolean;
    choose?: (notification: RecordedNotification) => string | undefined;
  } = {}
) {
  const vscode = createFakeVscode({
    settings: { 'proxyToggler.showSwitchNotifications': options.toasts ?? false }
  });
  const recorder = createNotificationRecorder(options.choose);
  const proxyManager = new ProxyManager(
    createMemento(),
    createHttpSettings(),
    createProfilesSetting([])
  );
  // Notifications already recorded at each refresh; inform never calls `choose`, so this count is
  // what shows the order.
  const seenAtRefresh: number[] = [];
  const change = createProxyChange(vscode, proxyManager, recorder, async () => {
    seenAtRefresh.push(recorder.notifications.length);
  });
  return { vscode, recorder, seenAtRefresh, change };
}

const returning =
  <O extends ProxyOutcome>(outcome: O) =>
  (): Promise<O> =>
    Promise.resolve(outcome);

const throwing = (error: Error) => (): Promise<never> => Promise.reject(error);

function shown(notifications: RecordedNotification[]): string[][] {
  return notifications.map(({ kind, message }) => [kind, message]);
}

function buttons(notifications: RecordedNotification[]): string[][] {
  return notifications.map(({ actions }) => actions.map(({ title }) => title));
}

const REPORTS: Array<{
  label: string;
  outcome: ProxyOutcome;
  gated: boolean;
  expected: string[][];
}> = [
  {
    label: 'turning on',
    outcome: { kind: 'on', profile: WORK },
    gated: true,
    expected: [['success', 'Proxy Toggler turned on Work.']]
  },
  {
    label: 'turning off',
    outcome: { kind: 'off', profile: WORK },
    gated: true,
    expected: [['success', 'Proxy Toggler turned off Work.']]
  },
  {
    label: 'turning off with no profile',
    outcome: { kind: 'off' },
    gated: true,
    expected: [['success', 'Proxy Toggler turned the proxy off.']]
  },
  {
    label: 'a delete',
    outcome: { kind: 'deleted', name: 'Work' },
    gated: true,
    expected: [['success', 'Proxy Toggler deleted Work.']]
  },
  {
    label: 'a rename',
    outcome: { kind: 'saved', profile: OFFICE, renamedFrom: 'Work', isOn: false },
    gated: false,
    expected: [
      ['warning', 'Renamed Work to Office. Keybindings that switch to "Work" by name stop working.']
    ]
  },
  {
    label: 'a save without a rename',
    outcome: { kind: 'saved', profile: WORK, isOn: true },
    gated: false,
    expected: []
  },
  {
    label: 'a taken name',
    outcome: {
      kind: 'nameTaken',
      name: 'Work',
      reason: '"Work" is already used in proxyToggler.profiles.'
    },
    gated: false,
    expected: []
  },
  {
    label: 'a profile already deleted',
    outcome: { kind: 'gone', name: 'Work', change: 'delete' },
    gated: false,
    expected: [['warning', 'Work was already deleted, in another window or through Settings Sync.']]
  },
  {
    label: 'a profile gone before a switch',
    outcome: { kind: 'gone', name: 'Work', change: 'switch' },
    gated: false,
    expected: [
      [
        'warning',
        'No proxy profile is named "Work". The list may have changed in another window or through Settings Sync.'
      ]
    ]
  },
  {
    label: 'a profile gone before a save',
    outcome: { kind: 'gone', name: 'Work', change: 'save' },
    gated: false,
    expected: [
      [
        'warning',
        'No proxy profile is named "Work". The list may have changed in another window or through Settings Sync.'
      ]
    ]
  },
  {
    label: 'no profile at all',
    outcome: { kind: 'notConfigured' },
    gated: false,
    expected: [['warning', 'No proxy configuration found. Please configure proxy settings first.']]
  }
];

describe('proxy change', () => {
  for (const { label, outcome, gated, expected } of REPORTS) {
    for (const toasts of [true, false]) {
      it(`reports ${label} with switch notifications ${toasts ? 'on' : 'off'}`, async () => {
        const { recorder, change } = setup({ toasts });

        await change(returning(outcome));

        assert.deepEqual(shown(recorder.notifications), gated && !toasts ? [] : expected);
      });
    }
  }

  it('refreshes before it says anything, even when the change fails', async () => {
    const succeeded = setup({ toasts: true });
    await succeeded.change(returning({ kind: 'on', profile: WORK }));
    assert.deepEqual(succeeded.seenAtRefresh, [0]);
    assert.equal(succeeded.recorder.notifications.length, 1);

    const writeFailed = setup();
    await writeFailed.change(throwing(new ConfigurationError('enable', 'proxy')));
    assert.deepEqual(writeFailed.seenAtRefresh, [0]);
    assert.equal(writeFailed.recorder.notifications.length, 1);

    const crashed = setup();
    await assert.rejects(() => crashed.change(throwing(new Error('boom'))), /boom/);
    assert.deepEqual(crashed.seenAtRefresh, [0]);
    assert.deepEqual(crashed.recorder.notifications, []);
  });

  it('returns the outcome it was given', async () => {
    const { change } = setup();
    const outcome = { kind: 'on', profile: WORK } as const;

    assert.equal(await change(returning(outcome)), outcome);
  });

  it('runs Configure Now when chosen', async () => {
    const { vscode, recorder, change } = setup({ choose: () => 'configure' });

    await change(returning({ kind: 'notConfigured' }));

    assert.deepEqual(buttons(recorder.notifications), [['Configure Now']]);
    assert.deepEqual(vscode.executedCommands, [{ command: 'proxyToggler.configure', args: [] }]);
  });

  it('offers Turn Proxy Off only after a failed turn-on', async () => {
    const turningOn = setup();
    assert.deepEqual(await turningOn.change(throwing(new ConfigurationError('enable', 'proxy'))), {
      kind: 'writeFailed'
    });
    assert.deepEqual(buttons(turningOn.recorder.notifications), [
      ['Open Settings', 'Turn Proxy Off']
    ]);

    const turningOff = setup();
    assert.deepEqual(
      await turningOff.change(throwing(new ConfigurationError('disable', 'proxy'))),
      { kind: 'writeFailed' }
    );
    assert.deepEqual(buttons(turningOff.recorder.notifications), [['Open Settings']]);
  });

  it('explains a saved edit that could not be applied in its own words', async () => {
    const { recorder, change } = setup();

    await change(
      throwing(new ProfileApplyError('Work', new ConfigurationError('enable', 'proxy')))
    );

    assert.deepEqual(shown(recorder.notifications), [
      [
        'error',
        'Saved Work, but could not fully apply the changes because VS Code setting "http.proxy" could not be updated. Your settings may be managed by policy.'
      ]
    ]);
    assert.deepEqual(buttons(recorder.notifications), [['Open Settings', 'Turn Proxy Off']]);
  });

  it('opens the failed setting, or turns the proxy off, when asked', async () => {
    const opening = setup({ choose: () => 'openSettings' });
    await opening.change(throwing(new ConfigurationError('enable', 'noProxy')));
    assert.deepEqual(opening.vscode.executedCommands, [
      { command: 'workbench.action.openSettings', args: ['http.noProxy'] }
    ]);

    const turningOff = setup({ choose: () => 'disableProxy' });
    await turningOff.change(throwing(new ConfigurationError('enable', 'proxy')));
    assert.deepEqual(turningOff.vscode.executedCommands, [
      { command: 'proxyToggler.disable', args: [] }
    ]);
  });

  it('rethrows a saved-edit error whose cause is not a failed setting write', async () => {
    const { recorder, change } = setup();

    await assert.rejects(
      () => change(throwing(new ProfileApplyError('Work', new Error('disk')))),
      ProfileApplyError
    );
    assert.deepEqual(recorder.notifications, []);
  });
});
