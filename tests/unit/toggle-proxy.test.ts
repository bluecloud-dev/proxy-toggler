import { strict as assert } from 'node:assert';

import { COMMANDS } from '../../src/commands/command-ids';
import { createProxyToggler } from '../../src/proxy-toggler';
import { createFakeVscode, failSettingWrites } from '../support/fake-vscode';
import { createExtensionContext } from '../support/fakes';

const WORK = {
  name: 'Work',
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  bypassList: []
};

const APPLIED_WORK = {
  'http.proxy': WORK.proxyUrl,
  'http.proxyStrictSSL': true,
  'http.noProxy': []
};

function activate(isEnabled: boolean, settings: Record<string, unknown> = {}, choice?: string) {
  const vscode = createFakeVscode({
    settings: {
      'proxyToggler.profiles': [WORK],
      ...(isEnabled ? APPLIED_WORK : {}),
      ...settings
    },
    answer: ({ kind }) => (kind === 'warning' ? choice : undefined)
  });
  const state = new Map([['proxyToggler.state', { isEnabled, currentProfile: WORK }]]);
  createProxyToggler(vscode, createExtensionContext({ state }));
  return vscode;
}

describe('toggle', () => {
  it('offers Open Settings but not Turn Proxy Off after a failed turn-off', async () => {
    const vscode = activate(true);
    failSettingWrites(vscode);

    await vscode.commandHandlers.get(COMMANDS.toggle)?.();

    assert.deepEqual(
      vscode.messages.map(({ kind, items }) => [kind, items]),
      [['error', ['Open Settings']]]
    );
  });

  describe('with confirmBeforeToggle on', () => {
    // Toggles, answering the confirmation with the button `choice`.
    async function toggleConfirmed(isEnabled: boolean, choice: string) {
      const vscode = activate(isEnabled, { 'proxyToggler.confirmBeforeToggle': true }, choice);
      await vscode.commandHandlers.get(COMMANDS.toggle)?.();
      return vscode;
    }

    it('asks before turning the proxy off, and leaves it on when cancelled', async () => {
      const vscode = await toggleConfirmed(true, 'Cancel');

      assert.deepEqual(
        vscode.messages.map(({ kind, message, items }) => [kind, message, items]),
        [['warning', 'Turn proxy off?', ['Turn Off', 'Cancel']]]
      );
      assert.equal(vscode.settings.get('http.proxy'), WORK.proxyUrl);
      assert.deepEqual(vscode.settingUpdates, []);
    });

    it('turns the proxy off when Turn Off is chosen', async () => {
      const vscode = await toggleConfirmed(true, 'Turn Off');

      assert.equal(vscode.settings.has('http.proxy'), false);
    });

    it('asks before turning the proxy on, and turns it on when Turn On is chosen', async () => {
      const vscode = await toggleConfirmed(false, 'Turn On');

      assert.deepEqual(
        vscode.messages.map(({ kind, message, items }) => [kind, message, items]),
        [['warning', 'Turn proxy on?', ['Turn On', 'Cancel']]]
      );
      assert.equal(vscode.settings.get('http.proxy'), WORK.proxyUrl);
    });
  });
});
