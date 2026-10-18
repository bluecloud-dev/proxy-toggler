import { strict as assert } from 'node:assert';

import * as sinon from 'sinon';
import * as vscode from 'vscode';

async function configureWithoutCredentials(
  sandbox: sinon.SinonSandbox,
  options: {
    proxyUrl: string;
    noProxy?: string;
    strictSSL?: boolean;
  }
): Promise<void> {
  sandbox.restore();
  sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
  sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);
  sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

  const noProxy = options.noProxy ?? '';
  const strictSSL = options.strictSSL ?? true;
  const inputs = [options.proxyUrl, '', noProxy];
  let inputIndex = 0;

  sandbox.stub(vscode.window, 'showInputBox').callsFake(async () => inputs[inputIndex++]);
  sandbox
    .stub(vscode.window, 'showQuickPick')
    .callsFake(
      async (
        items: readonly vscode.QuickPickItem[] | Thenable<readonly vscode.QuickPickItem[]>
      ): Promise<vscode.QuickPickItem | undefined> => {
        const resolvedItems = await Promise.resolve(items);
        const match = resolvedItems.find(
          (item) => (item as unknown as { value?: boolean }).value === strictSSL
        );
        return match ?? resolvedItems[0];
      }
    );
  await vscode.commands.executeCommand('proxyToggler.configure');
}

describe('VS Code http proxy updates', function () {
  // VS Code settings updates can take a moment in the test host.
  // Keep timeouts generous to avoid flakiness.
  this.timeout(20000);

  function normalizeNoProxy(value: unknown): string {
    if (Array.isArray(value)) {
      return value
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0)
        .join(',');
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .join(',');
    }
    return '';
  }

  it('enables proxy by writing global http settings', async () => {
    const sandbox = sinon.createSandbox();
    try {
      await configureWithoutCredentials(sandbox, {
        proxyUrl: 'http://proxy.example.com:8080',
        noProxy: '',
        strictSSL: true
      });

      await vscode.commands.executeCommand('proxyToggler.enable');

      const httpConfig = vscode.workspace.getConfiguration('http');

      assert.equal(
        httpConfig.inspect<string>('proxy')?.globalValue,
        'http://proxy.example.com:8080'
      );
      assert.equal(httpConfig.inspect<boolean>('proxyStrictSSL')?.globalValue, true);
      assert.equal(
        normalizeNoProxy(httpConfig.inspect<unknown>('noProxy')?.globalValue),
        'localhost,127.0.0.1'
      );
      assert.equal(httpConfig.inspect<string>('proxyAuthorization')?.globalValue, undefined);
    } finally {
      sandbox.restore();
    }
  });

  it('disables proxy by clearing global http settings to undefined', async () => {
    const sandbox = sinon.createSandbox();
    try {
      await configureWithoutCredentials(sandbox, {
        proxyUrl: 'http://proxy.example.com:8080',
        noProxy: 'localhost',
        strictSSL: true
      });

      await vscode.commands.executeCommand('proxyToggler.enable');
      await vscode.commands.executeCommand('proxyToggler.disable');

      const httpConfig = vscode.workspace.getConfiguration('http');

      assert.equal(httpConfig.inspect<string>('proxy')?.globalValue, undefined);
      assert.equal(httpConfig.inspect<boolean>('proxyStrictSSL')?.globalValue, undefined);
      assert.equal(httpConfig.inspect<unknown>('noProxy')?.globalValue, undefined);
      assert.equal(httpConfig.inspect<string>('proxyAuthorization')?.globalValue, undefined);
    } finally {
      sandbox.restore();
    }
  });
});
