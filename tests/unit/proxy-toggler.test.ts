import { strict as assert } from 'node:assert';

import { COMMANDS } from '../../src/commands/command-ids';
import { createProxyToggler } from '../../src/proxy-toggler';
import { createFakeVscode, type FakeVscodeOptions } from '../support/fake-vscode';
import { createExtensionContext, flushBackgroundTasks } from '../support/fakes';

const PROFILE = {
  name: 'Work',
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  bypassList: ['localhost']
};

const PROFILES = { 'proxyToggler.profiles': [PROFILE] };

const APPLIED_SETTINGS = {
  'http.proxy': 'http://proxy.example.com:8080',
  'http.proxyStrictSSL': true,
  'http.noProxy': 'localhost'
};

function activateWith(options: FakeVscodeOptions, state?: Record<string, unknown>) {
  const vscode = createFakeVscode(options);
  const context = createExtensionContext({ state: new Map(Object.entries(state ?? {})) });
  const api = createProxyToggler(vscode, context);
  return { vscode, context, api };
}

describe('createProxyToggler', () => {
  it('registers every command and owns its disposables', () => {
    const { vscode, context } = activateWith({});

    assert.deepEqual(
      [...vscode.commandHandlers.keys()],
      [
        COMMANDS.configure,
        COMMANDS.enable,
        COMMANDS.disable,
        COMMANDS.toggle,
        COMMANDS.switchProfile
      ]
    );
    assert.equal(context.subscriptions.length, 10);
  });

  it('runs every command without a saved configuration', async () => {
    const { vscode } = activateWith({});

    for (const command of Object.values(COMMANDS)) {
      await vscode.commandHandlers.get(command)?.();
    }

    // Enable and toggle offer to configure; success toasts are off by default.
    assert.deepEqual(
      vscode.messages.map((message) => message.kind),
      ['warning', 'warning']
    );
  });

  it('turns the record on without asking when the settings match a profile at activation', async () => {
    const { vscode, api } = activateWith(
      { settings: { ...APPLIED_SETTINGS, ...PROFILES } },
      { 'proxyToggler.state': { isEnabled: false, hasConfiguration: true } }
    );

    await flushBackgroundTasks();

    assert.deepEqual(vscode.messages, []);
    assert.equal(api.getState().isEnabled, true);
  });

  it('does not undo a change made while the drift prompt was open', async () => {
    let acceptSync = (): void => undefined;
    const syncAccepted = new Promise<string>((resolve) => {
      acceptSync = () => resolve('Sync');
    });
    const { vscode, api } = activateWith(
      // Only the drift warning waits for the user; the enable command's notification does not.
      {
        settings: PROFILES,
        answer: (message) => (message.kind === 'warning' ? syncAccepted : undefined)
      },
      { 'proxyToggler.state': { isEnabled: true, hasConfiguration: true } }
    );

    await vscode.commandHandlers.get(COMMANDS.enable)?.();
    acceptSync();
    await flushBackgroundTasks();

    assert.equal(vscode.settings.get('http.proxy'), PROFILE.proxyUrl);
    assert.equal(api.getState().isEnabled, true);
  });

  it('turns a profile added by hand on and off from the status bar', async () => {
    const { vscode, api } = activateWith({});
    await flushBackgroundTasks();
    const beforeEdit = api.getStatusBarText();

    vscode.changeSettings(PROFILES);
    await flushBackgroundTasks();
    const afterEdit = api.getStatusBarText();
    await vscode.commandHandlers.get(COMMANDS.toggle)?.();
    const proxyWhenOn = vscode.settings.get('http.proxy');
    await vscode.commandHandlers.get(COMMANDS.toggle)?.();

    assert.match(beforeEdit ?? '', /not configured/i);
    assert.match(afterEdit ?? '', /proxy: off/i);
    assert.equal(proxyWhenOn, PROFILE.proxyUrl);
    assert.equal(vscode.settings.has('http.proxy'), false);
    assert.match(api.getStatusBarText() ?? '', /proxy: off/i);
  });

  describe('status bar', () => {
    const HOME = { ...PROFILE, name: 'Home', proxyUrl: 'http://home.example:3128' };
    const statusOf = (vscode: ReturnType<typeof createFakeVscode>) => {
      const [item] = vscode.statusBarItems;
      return {
        text: item?.text,
        tooltip: item?.tooltip,
        label: item?.accessibilityInformation?.label
      };
    };

    it('says ON or OFF with one profile, and names it in the tooltip and label', async () => {
      const { vscode } = activateWith(
        { settings: { ...PROFILES, ...APPLIED_SETTINGS } },
        { 'proxyToggler.state': { isEnabled: true, currentProfile: PROFILE } }
      );
      await flushBackgroundTasks();

      assert.deepEqual(statusOf(vscode), {
        text: '$(plug) Proxy: ON',
        tooltip: 'Proxy on: Work. Click to turn it off.',
        label: 'Proxy on, profile Work'
      });
    });

    it('shows the current profile while on once two or more profiles exist', async () => {
      const settings = { 'proxyToggler.profiles': [HOME, PROFILE] };
      const on = activateWith(
        { settings: { ...settings, ...APPLIED_SETTINGS } },
        { 'proxyToggler.state': { isEnabled: true, currentProfile: PROFILE } }
      );
      const off = activateWith(
        { settings },
        { 'proxyToggler.state': { isEnabled: false, currentProfile: PROFILE } }
      );
      await flushBackgroundTasks();

      assert.equal(statusOf(on.vscode).text, '$(plug) Proxy: Work');
      assert.deepEqual(statusOf(off.vscode), {
        text: '$(debug-disconnect) Proxy: OFF',
        tooltip: 'Proxy off. Click to turn on Work.',
        label: 'Proxy off, profile Work'
      });
    });
  });

  it('does not check drift without profiles', async () => {
    const { vscode } = activateWith({ settings: APPLIED_SETTINGS });

    await flushBackgroundTasks();

    assert.deepEqual(vscode.messages, []);
  });

  it('does not prompt when the stored state matches the settings', async () => {
    const { vscode } = activateWith(
      { settings: { ...APPLIED_SETTINGS, ...PROFILES } },
      { 'proxyToggler.state': { isEnabled: true, hasConfiguration: true } }
    );

    await flushBackgroundTasks();

    assert.deepEqual(vscode.messages, []);
  });

  it('does not prompt when http.noProxy holds the same bypass patterns as a list', async () => {
    const { vscode } = activateWith(
      { settings: { ...APPLIED_SETTINGS, 'http.noProxy': ['localhost'], ...PROFILES } },
      { 'proxyToggler.state': { isEnabled: true, hasConfiguration: true } }
    );

    await flushBackgroundTasks();

    assert.deepEqual(vscode.messages, []);
  });

  it('writes http.noProxy as an array', async () => {
    const { vscode } = activateWith(
      {
        settings: {
          'proxyToggler.profiles': [{ ...PROFILE, bypassList: ['localhost', '127.0.0.1'] }]
        }
      },
      { 'proxyToggler.state': { isEnabled: false, hasConfiguration: true } }
    );

    await vscode.commandHandlers.get(COMMANDS.enable)?.();

    assert.deepEqual(vscode.settings.get('http.noProxy'), ['localhost', '127.0.0.1']);
  });

  describe('when VS Code echoes an older stored state after a newer write', () => {
    // VS Code sends every change of the extension's state back to the extension host, and an echo
    // of an earlier write can arrive after a newer one and replace it for a moment.
    const STALE_ECHO = { isEnabled: false, hasConfiguration: true };

    it('still shows the latest state', async () => {
      const { vscode, context, api } = activateWith(
        { settings: PROFILES },
        { 'proxyToggler.state': { isEnabled: false, hasConfiguration: true } }
      );

      await vscode.commandHandlers.get(COMMANDS.enable)?.();
      context.globalState.store.set('proxyToggler.state', STALE_ECHO);
      await api.refreshUi();

      assert.equal(api.getState().isEnabled, true);
      assert.match(api.getStatusBarText() ?? '', /proxy: on/i);
    });

    it('toggles from the latest state, not from the echo', async () => {
      const { vscode, context, api } = activateWith(
        { settings: PROFILES },
        { 'proxyToggler.state': { isEnabled: false, hasConfiguration: true } }
      );

      await vscode.commandHandlers.get(COMMANDS.toggle)?.();
      context.globalState.store.set('proxyToggler.state', STALE_ECHO);
      await vscode.commandHandlers.get(COMMANDS.toggle)?.();

      assert.equal(api.getState().isEnabled, false);
      assert.equal(vscode.settings.has('http.proxy'), false);
    });
  });

  it('logs an unexpected failure and shows the command failure message', async () => {
    const { vscode } = activateWith({});
    vscode.window.createInputBox = () => {
      throw new Error('input box failed');
    };

    await vscode.commandHandlers.get(COMMANDS.configure)?.();

    assert.deepEqual(
      vscode.messages.map((message) => [message.kind, message.message]),
      [['error', 'Failed to configure proxy.']]
    );
    assert.match(vscode.logs.join('\n'), /input box failed/);
  });

  it('logs failed background work instead of dropping it', async () => {
    const vscode = createFakeVscode();
    vscode.commands.executeCommand = async () => {
      throw new Error('setContext failed');
    };

    createProxyToggler(vscode, createExtensionContext());
    await flushBackgroundTasks();

    assert.match(vscode.logs.join('\n'), /Status bar refresh failed.*setContext failed/);
  });
});
