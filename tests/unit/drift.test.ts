import { strict as assert } from 'node:assert';

import type { QuickPickItem } from 'vscode';

import { COMMANDS, CONTEXT_KEYS } from '../../src/commands/command-ids';
import { createProxyToggler } from '../../src/proxy-toggler';
import {
  createFakeVscode,
  type FakeQuickPick,
  type FakeVscodeOptions
} from '../support/fake-vscode';
import { createExtensionContext, flushBackgroundTasks } from '../support/fakes';

const WORK = {
  name: 'Work',
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  bypassList: []
};

// A proxy that matches no profile.
const ELSEWHERE = {
  'http.proxy': 'http://elsewhere.example:3128',
  'http.proxyStrictSSL': true,
  'http.noProxy': ['.corp.example.com']
};

const DRIFT_TEXT = 'VS Code uses a proxy that matches no profile';

const choose =
  (label: string) =>
  (quickPick: FakeQuickPick): void =>
    quickPick.accept(quickPick.items.find((item: QuickPickItem) => item.label === label));

async function activate(options: FakeVscodeOptions, isEnabled = true) {
  const vscode = createFakeVscode({
    ...options,
    settings: { 'proxyToggler.profiles': [WORK], ...ELSEWHERE, ...options.settings }
  });
  const state = new Map<string, unknown>([
    ['proxyToggler.state', { isEnabled, currentProfile: WORK }]
  ]);
  const api = createProxyToggler(vscode, createExtensionContext({ state }));
  await flushBackgroundTasks();
  return { vscode, api };
}

const toggle = (vscode: ReturnType<typeof createFakeVscode>) => vscode.statusBarItems[0];

describe('drift', () => {
  it('shows on the toggle, which keeps its text, and to screen readers, without a notification', async () => {
    const { vscode } = await activate({});

    assert.equal(toggle(vscode)?.text, '$(warning) Proxy: ON');
    assert.match(toggle(vscode)?.tooltip as string, new RegExp(DRIFT_TEXT));
    assert.match(toggle(vscode)?.accessibilityInformation?.label ?? '', new RegExp(DRIFT_TEXT));
    assert.equal(toggle(vscode)?.backgroundColor?.id, 'statusBarItem.warningBackground');
    assert.deepEqual(vscode.messages, []);
  });

  it('ends when the settings match a profile again', async () => {
    const { vscode } = await activate({});

    vscode.changeSettings({
      'http.proxy': WORK.proxyUrl,
      'http.noProxy': []
    });
    await vscode.commandHandlers.get(COMMANDS.enable)?.();

    assert.equal(toggle(vscode)?.text, '$(plug) Proxy: ON');
    assert.equal(toggle(vscode)?.backgroundColor, undefined);
  });

  it('lets the Command Palette offer Turn Proxy Off', async () => {
    const { vscode } = await activate({}, false);

    assert.ok(
      vscode.executedCommands.some(
        ({ command, args }) =>
          command === 'setContext' && args[0] === CONTEXT_KEYS.hasDrift && args[1] === true
      )
    );
  });

  describe('in the switcher', () => {
    it('re-applies the current profile while on', async () => {
      const { vscode } = await activate({ quickPick: choose('Re-apply Work') });

      await vscode.commandHandlers.get(COMMANDS.switchProfile)?.();

      assert.equal(vscode.settings.get('http.proxy'), WORK.proxyUrl);
    });

    it('turns the proxy off while off', async () => {
      const { vscode } = await activate({ quickPick: choose('Turn Proxy Off') }, false);

      await vscode.commandHandlers.get(COMMANDS.switchProfile)?.();

      assert.equal(vscode.settings.has('http.proxy'), false);
    });

    it('saves the current settings as a profile, which then matches them and is on', async () => {
      const { vscode, api } = await activate({
        quickPick: choose('Save Current Settings as Profile…'),
        inputBox: (box) => box.submit()
      });

      await vscode.commandHandlers.get(COMMANDS.switchProfile)?.();

      assert.equal(vscode.inputBoxes[0]?.value, 'http://elsewhere.example:3128');
      assert.deepEqual(api.getState().currentProfile, {
        name: 'elsewhere.example',
        proxyUrl: 'http://elsewhere.example:3128',
        strictSSL: true,
        bypassList: ['.corp.example.com']
      });
      assert.equal(api.getState().isEnabled, true);
      assert.equal(toggle(vscode)?.backgroundColor, undefined);
    });

    it('names the values a profile cannot hold instead of saving', async () => {
      const { vscode } = await activate({
        settings: { 'http.noProxy': ['10.0.0.0/8'] },
        quickPick: choose('Save Current Settings as Profile…')
      });

      await vscode.commandHandlers.get(COMMANDS.switchProfile)?.();

      assert.equal(vscode.inputBoxes.length, 0);
      assert.match(vscode.messages.at(-1)?.message ?? '', /bypass pattern "10\.0\.0\.0\/8"/);
    });
  });

  describe('with no profiles', () => {
    it('is not drift: the toggle says VS Code already uses a proxy, and a click starts setup from it', async () => {
      const { vscode } = await activate({ settings: { 'proxyToggler.profiles': [] } });

      await vscode.commandHandlers.get(COMMANDS.toggle)?.();

      assert.equal(toggle(vscode)?.text, '$(warning) Proxy: Not Configured');
      assert.match(toggle(vscode)?.tooltip as string, /VS Code already uses a proxy/);
      assert.match(toggle(vscode)?.accessibilityInformation?.label ?? '', /already uses a proxy/);
      assert.equal(vscode.inputBoxes[0]?.value, 'http://elsewhere.example:3128');
    });
  });
});
