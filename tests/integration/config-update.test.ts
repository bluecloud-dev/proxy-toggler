import { strict as assert } from 'node:assert';

import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { configureWithoutCredentials, dismissNotifications } from './support';

// Makes every write to one http.* setting fail, as when a policy manages that setting.
function failWritesTo(sandbox: sinon.SinonSandbox, failingKey: string): void {
  const getConfiguration = vscode.workspace.getConfiguration;
  sandbox
    .stub(vscode.workspace, 'getConfiguration')
    .callsFake((section?: string, scope?: vscode.ConfigurationScope | null) => {
      const configuration = getConfiguration(section, scope);
      if (section !== 'http') {
        return configuration;
      }

      return {
        ...configuration,
        update: async (
          key: string,
          value: unknown,
          target?: vscode.ConfigurationTarget | boolean | null
        ) => {
          if (key === failingKey) {
            throw new Error(`http.${key} is managed by policy`);
          }
          await configuration.update(key, value, target);
        }
      };
    });
}

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

  it('restores the user settings it wrote when a later write fails', async () => {
    const http = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration('http');
    await http().update('proxy', 'http://old.example.com:3128', vscode.ConfigurationTarget.Global);

    try {
      await configureWithoutCredentials(sandbox, {
        proxyUrl: 'http://proxy.example.com:8080',
        noProxy: 'localhost',
        strictSSL: true
      });
      failWritesTo(sandbox, 'noProxy');

      await vscode.commands.executeCommand('proxyToggler.enable');

      assert.equal(http().inspect<string>('proxy')?.globalValue, 'http://old.example.com:3128');
      // http.proxyStrictSSL defaults to true; the rollback must not write that default.
      assert.equal(http().inspect<boolean>('proxyStrictSSL')?.globalValue, undefined);
    } finally {
      await http().update('proxy', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
