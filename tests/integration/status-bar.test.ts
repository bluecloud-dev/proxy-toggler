import { strict as assert } from 'node:assert';

import * as sinon from 'sinon';
import * as vscode from 'vscode';

type ProxyTogglerApi = {
  refreshUi: () => Promise<void>;
  getStatusBarText: () => string | undefined;
  getStatusBarAccessibilityLabel: () => string | undefined;
};

describe('status bar state', function () {
  this.timeout(20000);

  it('updates status bar text and accessibility label when toggling', async () => {
    const sandbox = sinon.createSandbox();
    sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);
    sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

    const extension = vscode.extensions.getExtension('aymenhammouda.proxy-toggler');
    assert.ok(extension, 'Expected extension to be available in VS Code test host');

    try {
      const api = (await extension.activate()) as unknown as ProxyTogglerApi;

      const inputs = ['http://proxy.example.com:8080', '', 'localhost'];
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
              (item) => (item as unknown as { value?: boolean }).value === true
            );
            return match ?? resolvedItems[0];
          }
        );

      await vscode.commands.executeCommand('proxyToggler.configure');

      await vscode.commands.executeCommand('proxyToggler.disable');
      await api.refreshUi();

      assert.match(api.getStatusBarText() ?? '', /proxy:/i);
      assert.match(api.getStatusBarText() ?? '', /off/i);
      assert.match(api.getStatusBarAccessibilityLabel() ?? '', /disabled/i);

      await vscode.commands.executeCommand('proxyToggler.enable');
      await api.refreshUi();
      assert.match(api.getStatusBarText() ?? '', /on/i);
      assert.match(api.getStatusBarAccessibilityLabel() ?? '', /enabled/i);

      await vscode.commands.executeCommand('proxyToggler.disable');
      await api.refreshUi();
      assert.match(api.getStatusBarText() ?? '', /off/i);
      assert.match(api.getStatusBarAccessibilityLabel() ?? '', /disabled/i);
    } finally {
      sandbox.restore();
    }
  });
});
