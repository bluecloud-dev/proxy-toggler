import { strict as assert } from 'node:assert';

import type * as sinon from 'sinon';
import * as vscode from 'vscode';

import type { ProxyTogglerApi } from '../../src/proxy-toggler';

export const EXTENSION_ID = 'aymenhammouda.proxy-toggler';

export async function activateExtension(): Promise<ProxyTogglerApi> {
  const extension = vscode.extensions.getExtension<ProxyTogglerApi>(EXTENSION_ID);
  assert.ok(extension, 'Expected extension to be available in VS Code test host');
  return extension.activate();
}

export function dismissNotifications(sandbox: sinon.SinonSandbox): void {
  sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
  sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);
  sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
}

// Answers the configure wizard: proxy URL, an empty username (no credentials), the bypass list,
// and the strict SSL choice.
export async function configureWithoutCredentials(
  sandbox: sinon.SinonSandbox,
  options: { proxyUrl: string; noProxy: string; strictSSL: boolean }
): Promise<void> {
  const inputs = [options.proxyUrl, '', options.noProxy];
  sandbox.stub(vscode.window, 'showInputBox').callsFake(async () => inputs.shift());
  sandbox
    .stub(vscode.window, 'showQuickPick')
    .callsFake(
      async (
        items: readonly vscode.QuickPickItem[] | Thenable<readonly vscode.QuickPickItem[]>
      ): Promise<vscode.QuickPickItem | undefined> =>
        (await items).find((item) => (item as { value?: boolean }).value === options.strictSSL)
    );

  await vscode.commands.executeCommand('proxyToggler.configure');
}
