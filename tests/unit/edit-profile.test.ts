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
    assert.match(vscode.quickPicks[0]?.placeholder ?? '', /save.*apply.*immediately/i);
  });

  it('reports a saved edit that could not be applied and refreshes drift before the error', async () => {
    let statusAtError: string | undefined;
    const vscode = createFakeVscode({
      ...script([choose('Proxy URL')], [(box) => box.submit('http://new.example.com:3128')]),
      settings: { 'proxyToggler.profiles': [WORK, HOME], ...APPLIED },
      answer: ({ kind }) => {
        if (kind === 'error') {
          statusAtError = api.getStatusBarText();
        }
        return undefined;
      }
    });
    const getConfiguration = vscode.workspace.getConfiguration.bind(vscode.workspace);
    vscode.workspace.getConfiguration = (section) => {
      const config = getConfiguration(section);
      return section === 'http'
        ? {
            ...config,
            update: async (key, value, target) => {
              if (key === 'noProxy') {
                throw new Error('The setting is managed');
              }
              return config.update(key, value, target);
            }
          }
        : config;
    };
    const state = new Map<string, unknown>([
      ['proxyToggler.state', { isEnabled: true, currentProfile: WORK }]
    ]);
    const api = createProxyToggler(vscode, createExtensionContext({ state }));

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.equal(profiles(vscode)[0]?.proxyUrl, 'http://new.example.com:3128');
    assert.equal(vscode.settings.get('http.proxy'), WORK.proxyUrl);
    assert.match(vscode.messages[0]?.message ?? '', /saved.*could not.*apply/i);
    assert.match(vscode.messages[0]?.message ?? '', /http\.noProxy/);
    assert.deepEqual(vscode.messages[0]?.items, ['Open Settings', 'Turn Proxy Off']);
    assert.match(statusAtError ?? '', /warning/);
  });

  it('reports a saved edit when an unexpected error prevents re-application', async () => {
    const vscode = createFakeVscode({
      ...script([choose('Proxy URL')], [(box) => box.submit('http://new.example.com:3128')]),
      settings: {
        'proxyToggler.profiles': [WORK, HOME],
        ...APPLIED,
        'http.proxy': 'http://alice:secret@proxy.example.com:8080'
      }
    });
    const context = createExtensionContext({
      state: new Map([['proxyToggler.state', { isEnabled: true, currentProfile: WORK }]])
    });
    const update = context.globalState.update.bind(context.globalState);
    context.globalState.update = async (key, value) => {
      if (key === 'proxyToggler.credentialsRemovalNoticeShown') {
        throw new Error('notice failed');
      }
      await update(key, value);
    };
    createProxyToggler(vscode, context);

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.equal(profiles(vscode)[0]?.proxyUrl, 'http://new.example.com:3128');
    assert.match(vscode.messages[0]?.message ?? '', /saved.*could not.*apply/i);
    assert.match(vscode.messages[0]?.message ?? '', /output/i);
    assert.doesNotMatch(vscode.messages[0]?.message ?? '', /alice|secret/);
    assert.match(vscode.logs.join('\n'), /ProfileApplyError/);
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

  it('says so, and saves nothing, when the profile is gone before the edit is saved', async () => {
    // The input box answers after activation, so the window exists by then.
    const { vscode } = activate(
      script(
        [choose('Proxy URL')],
        [
          (box) => {
            // Another window, or Settings Sync, removes the profile meanwhile.
            vscode.changeSettings({ 'proxyToggler.profiles': [HOME] });
            box.submit('http://new.example.com:3128');
          }
        ]
      )
    );

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.deepEqual(profiles(vscode), [HOME]);
    assert.deepEqual(
      vscode.messages.map(({ kind, message }) => [kind, message]),
      [
        [
          'error',
          'Could not save Work: proxyToggler.profiles no longer has it. Another window or Settings Sync may have removed it.'
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
      [['Delete the profile Home? If it is on when deleted, the proxy turns off.', ['Delete']]]
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
    assert.match(vscode.messages[0]?.message ?? '', /proxy turns off/i);
    assert.equal(vscode.messages.at(-1)?.message, 'Proxy Toggler deleted Work.');
  });
});
