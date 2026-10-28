import { strict as assert } from 'node:assert';

import * as vscode from 'vscode';

import type { ProxyTogglerApi } from '../../src/proxy-toggler';

const EXTENSION_ID = 'bluecloud-dev.proxy-toggler';
const STARTUP_TIMEOUT_MS = 15_000;

// tests/run-packaged-test.ts runs this in a window that has the packaged VSIX installed and a
// folder nobody has trusted. VS Code disables an installed extension in Restricted Mode unless its
// manifest declares support.
export async function run(): Promise<void> {
  assert.equal(vscode.workspace.isTrusted, false, 'Expected the folder to open in Restricted Mode');

  const extension = vscode.extensions.getExtension<ProxyTogglerApi>(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} is not enabled in Restricted Mode`);

  // It starts once VS Code has started (onStartupFinished), with no command run.
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (!extension.isActive) {
    assert.ok(Date.now() < deadline, `${EXTENSION_ID} did not activate after start-up`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const api = await extension.activate();
  assert.match(api.getStatusBarText() ?? '', /not configured/i);
}
