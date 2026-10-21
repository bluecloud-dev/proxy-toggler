import { strict as assert } from 'node:assert';

import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { activateExtension, dismissNotifications, useProfile } from './support';

describe('status bar state', function () {
  this.timeout(20000);

  const sandbox = sinon.createSandbox();

  beforeEach(() => dismissNotifications(sandbox));
  afterEach(() => sandbox.restore());

  it('updates status bar text and accessibility label when toggling', async () => {
    const api = await activateExtension();
    await useProfile({
      proxyUrl: 'http://proxy.example.com:8080',
      bypassList: ['localhost'],
      strictSSL: true
    });

    const showsState = async (command: string, text: RegExp, label: RegExp): Promise<void> => {
      // The notifications are stubbed, so a failed command would otherwise only show as a wrong
      // status; the message names the stored state and any error that was shown.
      const shownErrors = vscode.window.showErrorMessage as unknown as sinon.SinonStub;
      const errorsBefore = shownErrors.callCount;
      await vscode.commands.executeCommand(command);
      await api.refreshUi();
      const details = `after ${command}: ${JSON.stringify({
        state: api.getState(),
        errors: shownErrors.args.slice(errorsBefore)
      })}`;
      assert.match(api.getStatusBarText() ?? '', text, details);
      assert.match(api.getStatusBarAccessibilityLabel() ?? '', label, details);
    };

    await showsState('proxyToggler.disable', /proxy: off/i, /proxy off/i);
    await showsState('proxyToggler.enable', /proxy: on/i, /proxy on/i);
    await showsState('proxyToggler.disable', /proxy: off/i, /proxy off/i);
  });
});
