import { strict as assert } from 'node:assert';

import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { activateExtension, configureWithoutCredentials, dismissNotifications } from './support';

describe('status bar state', function () {
  this.timeout(20000);

  const sandbox = sinon.createSandbox();

  beforeEach(() => dismissNotifications(sandbox));
  afterEach(() => sandbox.restore());

  it('updates status bar text and accessibility label when toggling', async () => {
    const api = await activateExtension();
    await configureWithoutCredentials(sandbox, {
      proxyUrl: 'http://proxy.example.com:8080',
      noProxy: 'localhost',
      strictSSL: true
    });

    const showsState = async (command: string, text: RegExp, label: RegExp): Promise<void> => {
      await vscode.commands.executeCommand(command);
      await api.refreshUi();
      assert.match(api.getStatusBarText() ?? '', text);
      assert.match(api.getStatusBarAccessibilityLabel() ?? '', label);
    };

    await showsState('proxyToggler.disable', /proxy: off/i, /disabled/i);
    await showsState('proxyToggler.enable', /proxy: on/i, /enabled/i);
    await showsState('proxyToggler.disable', /proxy: off/i, /disabled/i);
  });
});
