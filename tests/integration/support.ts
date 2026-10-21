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

// Makes this the only profile, so that it is the current one, as a user would by hand.
export async function useProfile(profile: {
  proxyUrl: string;
  bypassList: string[];
  strictSSL: boolean;
}): Promise<void> {
  await vscode.workspace
    .getConfiguration('proxyToggler')
    .update('profiles', [{ name: 'Test', ...profile }], vscode.ConfigurationTarget.Global);
}
