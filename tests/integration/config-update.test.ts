import { strict as assert } from 'node:assert';

import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { configureWithoutCredentials, dismissNotifications } from './support';

describe('VS Code http proxy updates', function () {
  // VS Code settings updates can take a moment in the test host.
  // Keep timeouts generous to avoid flakiness.
  this.timeout(20000);

  const sandbox = sinon.createSandbox();

  beforeEach(() => dismissNotifications(sandbox));
  afterEach(() => sandbox.restore());

  it('enables proxy by writing global http settings', async () => {
    await configureWithoutCredentials(sandbox, {
      proxyUrl: 'http://proxy.example.com:8080',
      noProxy: '',
      strictSSL: true
    });

    await vscode.commands.executeCommand('proxyToggler.enable');

    const http = vscode.workspace.getConfiguration('http');
    assert.equal(http.inspect<string>('proxy')?.globalValue, 'http://proxy.example.com:8080');
    assert.equal(http.inspect<boolean>('proxyStrictSSL')?.globalValue, true);
    assert.deepEqual(http.inspect<string[]>('noProxy')?.globalValue, ['localhost', '127.0.0.1']);
    assert.equal(http.inspect<string>('proxyAuthorization')?.globalValue, undefined);
  });

  it('disables proxy by clearing global http settings to undefined', async () => {
    await configureWithoutCredentials(sandbox, {
      proxyUrl: 'http://proxy.example.com:8080',
      noProxy: 'localhost',
      strictSSL: true
    });

    await vscode.commands.executeCommand('proxyToggler.enable');
    await vscode.commands.executeCommand('proxyToggler.disable');

    const http = vscode.workspace.getConfiguration('http');
    assert.equal(http.inspect<string>('proxy')?.globalValue, undefined);
    assert.equal(http.inspect<boolean>('proxyStrictSSL')?.globalValue, undefined);
    assert.equal(http.inspect<unknown>('noProxy')?.globalValue, undefined);
    assert.equal(http.inspect<string>('proxyAuthorization')?.globalValue, undefined);
  });
});
