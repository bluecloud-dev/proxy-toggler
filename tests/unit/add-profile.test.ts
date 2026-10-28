import { strict as assert } from 'node:assert';

import type { QuickPickItem } from 'vscode';

import { COMMANDS } from '../../src/commands/command-ids';
import { createProxyToggler } from '../../src/proxy-toggler';
import {
  createFakeVscode,
  type FakeInputBox,
  type FakeVscodeOptions
} from '../support/fake-vscode';
import { createExtensionContext } from '../support/fakes';

const WORK = {
  name: 'Work',
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  bypassList: []
};

type Step = (inputBox: FakeInputBox) => void;

// Answers the input boxes in order; each step receives the box it answers.
function steps(...answers: Step[]): FakeVscodeOptions['inputBox'] {
  return (inputBox, index) => answers[index]?.(inputBox) ?? inputBox.dismiss();
}

function activate(options: FakeVscodeOptions, state = new Map<string, unknown>()) {
  const vscode = createFakeVscode(options);
  const api = createProxyToggler(vscode, createExtensionContext({ state }));
  return { vscode, api, state };
}

describe('Add Profile', () => {
  it('asks for the proxy URL, then the name, with a Back button on the second step', async () => {
    const { vscode } = activate({
      inputBox: steps(
        (box) => box.submit('http://proxy.example.com:8080'),
        (box) => box.submit()
      )
    });

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    const [url, name] = vscode.inputBoxes;
    assert.deepEqual([url?.step, url?.totalSteps, url?.buttons.length], [1, 2, 0]);
    assert.deepEqual([name?.step, name?.totalSteps, name?.buttons.length], [2, 2, 1]);
    assert.equal(name?.value, 'proxy.example.com');
    assert.deepEqual(vscode.settings.get('proxyToggler.profiles'), [
      { ...WORK, name: 'proxy.example.com' }
    ]);
    assert.deepEqual(
      vscode.messages.map(({ message, items }) => [message, items]),
      [['Saved proxy.example.com. Turn it on now?', ['Turn On', 'Test Connection', 'Not Now']]]
    );
  });

  it('turns the new profile on from the notification', async () => {
    const { vscode, api } = activate({
      inputBox: steps(
        (box) => box.submit(WORK.proxyUrl),
        (box) => box.submit('Work')
      ),
      answer: () => 'Turn On'
    });

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.equal(vscode.settings.get('http.proxy'), WORK.proxyUrl);
    assert.equal(api.getState().isEnabled, true);
  });

  it('says the profile is gone when Turn On finds it removed', async () => {
    const { vscode } = activate({
      settings: { 'proxyToggler.showSwitchNotifications': true },
      inputBox: steps(
        (box) => box.submit(WORK.proxyUrl),
        (box) => box.submit('Work')
      ),
      // Another window removes the profile while the save prompt is open.
      answer: ({ items }) => {
        if (!items.includes('Turn On')) {
          return undefined;
        }
        vscode.changeSettings({ 'proxyToggler.profiles': [] });
        return 'Turn On';
      }
    });

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.deepEqual(
      vscode.messages.map(({ kind, message }) => [kind, message]),
      [
        ['info', 'Saved Work. Turn it on now?'],
        [
          'warning',
          'No proxy profile is named "Work". The list may have changed in another window or through Settings Sync.'
        ]
      ]
    );
    assert.equal(vscode.settings.has('http.proxy'), false);
  });

  it('reopens the name step with the reason when another window takes the name', async () => {
    const reopened: Array<{ step?: number; totalSteps?: number; value: string; message: unknown }> =
      [];
    const { vscode } = activate({
      inputBox: steps(
        (box) => box.submit(WORK.proxyUrl),
        (box) => {
          // Another window saves a profile with that name while this one is open.
          vscode.changeSettings({ 'proxyToggler.profiles': [{ ...WORK, name: 'Lab' }] });
          box.submit('Lab');
        },
        (box) => {
          reopened.push({
            step: box.step,
            totalSteps: box.totalSteps,
            value: box.value,
            message: box.validationMessage
          });
          box.submit('Office');
        }
      )
    });

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.deepEqual(reopened, [
      {
        step: 2,
        totalSteps: 2,
        value: 'Lab',
        message: '"Lab" is already used in proxyToggler.profiles.'
      }
    ]);
    // The proxy URL is kept, so there is no second URL step.
    assert.equal(vscode.inputBoxes.length, 3);
    assert.deepEqual(vscode.settings.get('proxyToggler.profiles'), [
      { ...WORK, name: 'Lab' },
      { ...WORK, name: 'Office' }
    ]);
    assert.deepEqual(
      vscode.messages.map(({ message }) => message),
      ['Saved Office. Turn it on now?']
    );
  });

  it('opens an empty URL step without a message', async () => {
    const { vscode } = activate({ inputBox: steps() });

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    const [url] = vscode.inputBoxes;
    assert.deepEqual([url?.value, url?.validationMessage], ['', undefined]);
  });

  it('goes back from the name to the proxy URL, keeping what was typed', async () => {
    const { vscode } = activate({
      inputBox: steps(
        (box) => box.submit('http://first.example.com:3128'),
        (box) => box.back(),
        (box) => box.submit('http://second.example.com:3128'),
        (box) => box.submit()
      )
    });

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.equal(vscode.inputBoxes[2]?.value, 'http://second.example.com:3128');
    assert.equal(vscode.inputBoxes[3]?.value, 'second.example.com');
  });

  it('refuses a proxy URL it cannot use, and then a name an entry already holds', async () => {
    const problems: Array<string | undefined> = [];
    const { vscode } = activate({
      settings: { 'proxyToggler.profiles': [WORK] },
      quickPick: (quickPick) =>
        quickPick.accept(
          quickPick.items.find((item: QuickPickItem) => item.label === 'Add Profile…')
        ),
      inputBox: steps(
        (box) => {
          box.submit('proxy.example.com');
          problems.push(box.validationMessage as string | undefined);
          box.submit('http://office.example:3128');
        },
        (box) => {
          box.submit(' WORK ');
          problems.push(box.validationMessage as string | undefined);
          box.submit('Office');
        }
      )
    });

    await vscode.commandHandlers.get(COMMANDS.switchProfile)?.();

    assert.equal(problems.length, 2);
    assert.match(problems[0] ?? '', /scheme|URL/i);
    assert.match(problems[1] ?? '', /already used/);
    assert.deepEqual(
      (vscode.settings.get('proxyToggler.profiles') as Array<{ name: string }>).map(
        (profile) => profile.name
      ),
      ['Work', 'Office']
    );
  });

  describe('when no profile exists and VS Code already uses a proxy', () => {
    const SETTINGS = {
      'http.proxy': 'http://alice:secret@proxy.example.com/',
      'http.proxyStrictSSL': false,
      'http.noProxy': ['.corp.example.com']
    };

    it('starts from those settings, and a profile that matches them is on at once', async () => {
      const { vscode, api } = activate({
        settings: SETTINGS,
        inputBox: steps(
          (box) => box.submit(),
          (box) => box.submit()
        )
      });

      await vscode.commandHandlers.get(COMMANDS.configure)?.();

      assert.equal(vscode.inputBoxes[0]?.value, 'http://proxy.example.com:80');
      assert.deepEqual(vscode.settings.get('proxyToggler.profiles'), [
        {
          name: 'proxy.example.com',
          proxyUrl: 'http://proxy.example.com:80',
          strictSSL: false,
          bypassList: ['.corp.example.com']
        }
      ]);
      assert.equal(api.getState().isEnabled, true);
      assert.deepEqual(
        vscode.messages.map(({ message, items }) => [message, items]),
        [
          [
            "Saved proxy.example.com. It matches VS Code's proxy settings, so it is on.",
            ['Test Connection']
          ]
        ]
      );
    });

    it('names the values a profile cannot hold, and can continue without them', async () => {
      const { vscode } = activate({
        settings: { ...SETTINGS, 'http.noProxy': ['10.0.0.0/8', '.corp.example.com'] },
        inputBox: steps(
          (box) => box.submit(),
          (box) => box.submit()
        ),
        answer: ({ kind }) => (kind === 'warning' ? 'Continue Without Them' : undefined)
      });

      await vscode.commandHandlers.get(COMMANDS.configure)?.();

      const [warning, saved] = vscode.messages;
      assert.match(warning?.message ?? '', /bypass pattern "10\.0\.0\.0\/8"/);
      assert.deepEqual(warning?.items, ['Continue Without Them', 'Open Settings']);
      assert.match(saved?.message ?? '', /turning it on replaces them/);
      assert.deepEqual(
        (vscode.settings.get('proxyToggler.profiles') as Array<{ bypassList: string[] }>)[0]
          ?.bypassList,
        ['.corp.example.com']
      );
    });

    it('opens the settings instead when the user asks', async () => {
      const { vscode } = activate({
        settings: { ...SETTINGS, 'http.noProxy': ['10.0.0.0/8'] },
        answer: () => 'Open Settings'
      });

      await vscode.commandHandlers.get(COMMANDS.configure)?.();

      assert.equal(vscode.inputBoxes.length, 0);
      assert.ok(
        vscode.executedCommands.some(
          ({ command }) => command === 'workbench.action.openApplicationSettingsJson'
        )
      );
    });

    it('never copies the credentials anywhere', async () => {
      const { vscode, state } = activate({
        settings: SETTINGS,
        inputBox: steps(
          (box) => box.submit(),
          (box) => box.submit()
        )
      });

      await vscode.commandHandlers.get(COMMANDS.configure)?.();

      assert.doesNotMatch(JSON.stringify(vscode.settings.get('proxyToggler.profiles')), /secret/);
      assert.doesNotMatch(JSON.stringify([...state.entries()]), /secret/);
      assert.doesNotMatch(JSON.stringify(vscode.messages), /secret/);
      assert.doesNotMatch(vscode.inputBoxes.map((box) => box.value).join(), /secret/);
    });
  });
});
