import { strict as assert } from 'node:assert';

import type { QuickPickItem } from 'vscode';

import { COMMANDS } from '../../src/commands/command-ids';
import { createProxyToggler } from '../../src/proxy-toggler';
import {
  createFakeVscode,
  type FakeInputBox,
  type FakeQuickPick,
  type FakeVscodeOptions
} from '../support/fake-vscode';
import { createExtensionContext } from '../support/fakes';

const WORK = {
  name: 'Work',
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  bypassList: ['localhost']
};

const HOME = {
  name: 'Home',
  proxyUrl: 'http://home.example:3128',
  strictSSL: true,
  bypassList: []
};

const APPLIED = {
  'http.proxy': WORK.proxyUrl,
  'http.proxyStrictSSL': true,
  'http.noProxy': ['localhost']
};

type PickStep = (quickPick: FakeQuickPick) => void;

// Answers the quick picks and input boxes in order; one with no answer is dismissed.
function script(picks: PickStep[], inputs: Array<(box: FakeInputBox) => void> = []) {
  return {
    quickPick: (quickPick: FakeQuickPick, index: number) =>
      (picks[index] ?? ((pick: FakeQuickPick) => pick.dismiss()))(quickPick),
    inputBox: (box: FakeInputBox, index: number) =>
      (inputs[index] ?? ((input: FakeInputBox) => input.dismiss()))(box)
  };
}

const choose =
  (label: string): PickStep =>
  (quickPick) =>
    quickPick.accept(quickPick.items.find((item: QuickPickItem) => item.label === label));

function activate(options: FakeVscodeOptions, record = { isEnabled: false, currentProfile: WORK }) {
  const vscode = createFakeVscode({
    ...options,
    settings: { 'proxyToggler.profiles': [WORK, HOME], ...options.settings }
  });
  const state = new Map<string, unknown>([['proxyToggler.state', record]]);
  const api = createProxyToggler(vscode, createExtensionContext({ state }));
  return { vscode, api };
}

const profiles = (vscode: ReturnType<typeof createFakeVscode>) =>
  vscode.settings.get('proxyToggler.profiles') as Array<typeof WORK>;

describe('Edit Profile', () => {
  it('asks which profile, with the current one focused, then lists its fields and values', async () => {
    const { vscode } = activate(script([choose('Edit Profile…'), choose('Work')]));

    await vscode.commandHandlers.get(COMMANDS.switchProfile)?.();

    const [, which, fields] = vscode.quickPicks;
    assert.deepEqual(
      which?.items.map((item) => item.label),
      ['Home', 'Work']
    );
    assert.equal(which?.activeItems[0]?.label, 'Work');
    assert.deepEqual(
      fields?.items.map((item) => [item.label, item.description]),
      [
        ['Name', 'Work'],
        ['Proxy URL', WORK.proxyUrl],
        ['Strict SSL', 'On'],
        ['Bypass list', 'localhost'],
        ['Test Connection…', undefined]
      ]
    );
  });

  it('saves each field on its own and returns to the list until Escape', async () => {
    const { vscode } = activate(
      script(
        [choose('Proxy URL'), choose('Strict SSL'), choose('Off')],
        [(box) => box.submit('http://new.example.com:3128')]
      )
    );

    // Configure edits the current profile.
    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.deepEqual(
      vscode.quickPicks.map((quickPick) => quickPick.title),
      ['Edit Work', 'Edit Work', 'Strict SSL for Work', 'Edit Work']
    );
    assert.deepEqual(profiles(vscode)[0], {
      ...WORK,
      proxyUrl: 'http://new.example.com:3128',
      strictSSL: false
    });
  });

  it('re-applies the current profile while the proxy is on', async () => {
    const { vscode } = activate(
      {
        ...script([choose('Bypass list')], [(box) => box.submit('localhost, .corp.example.com')]),
        settings: APPLIED
      },
      { isEnabled: true, currentProfile: WORK }
    );

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.deepEqual(vscode.settings.get('http.noProxy'), ['localhost', '.corp.example.com']);
  });

  it('warns after a rename that keybindings using the old name stop working', async () => {
    const { vscode, api } = activate(script([choose('Name')], [(box) => box.submit('Office')]));

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.equal(profiles(vscode)[0]?.name, 'Office');
    assert.equal(api.getState().currentProfile?.name, 'Office');
    assert.deepEqual(
      vscode.messages.map(({ kind, message }) => [kind, message]),
      [
        [
          'warning',
          'Renamed Work to Office. Keybindings that switch to "Work" by name stop working.'
        ]
      ]
    );
  });

  it('checks each field like the UI does everywhere else', async () => {
    const problems: unknown[] = [];
    const { vscode } = activate(
      script(
        [choose('Bypass list'), choose('Name')],
        [
          (box) => {
            box.submit('*');
            problems.push(box.validationMessage);
            box.dismiss();
          },
          (box) => {
            box.submit('home');
            problems.push(box.validationMessage);
            box.dismiss();
          }
        ]
      )
    );

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.match(String(problems[0]), /bypass pattern/i);
    assert.match(String(problems[1]), /already used/);
    assert.deepEqual(profiles(vscode), [WORK, HOME]);
  });
});

describe('Delete Profile', () => {
  it('asks which profile, then for confirmation, and deletes it', async () => {
    const { vscode } = activate({
      ...script([choose('Delete Profile…'), choose('Home')]),
      answer: () => 'Delete'
    });

    await vscode.commandHandlers.get(COMMANDS.switchProfile)?.();

    assert.deepEqual(
      vscode.messages.map(({ message, items }) => [message, items]),
      [['Delete the profile Home?', ['Delete']]]
    );
    assert.deepEqual(profiles(vscode), [WORK]);
  });

  it('keeps the profile when the confirmation is dismissed', async () => {
    const { vscode } = activate(script([choose('Delete Profile…'), choose('Home')]));

    await vscode.commandHandlers.get(COMMANDS.switchProfile)?.();

    assert.deepEqual(profiles(vscode), [WORK, HOME]);
  });

  it('turns the proxy off before deleting the current profile, then says so when asked to', async () => {
    const { vscode, api } = activate(
      {
        ...script([choose('Delete Profile…'), choose('Work')]),
        settings: { ...APPLIED, 'proxyToggler.showSwitchNotifications': true },
        answer: ({ kind }) => (kind === 'warning' ? 'Delete' : undefined)
      },
      { isEnabled: true, currentProfile: WORK }
    );

    await vscode.commandHandlers.get(COMMANDS.switchProfile)?.();

    assert.equal(vscode.settings.has('http.proxy'), false);
    assert.deepEqual(api.getState().currentProfile, HOME);
    assert.equal(vscode.messages.at(-1)?.message, 'Proxy Toggler deleted Work.');
  });
});
