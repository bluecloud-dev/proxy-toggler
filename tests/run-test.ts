import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-toggler-user-data-'));
  const extensionsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-toggler-extensions-'));

  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '..');
    const extensionTestsPath = path.resolve(__dirname, '..', 'out', 'tests', 'integration', 'index.js');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--user-data-dir', userDataDir, '--extensions-dir', extensionsDir]
    });
  } catch (error) {
    console.error('Failed to run VS Code integration tests.', error);
    process.exitCode = 1;
  } finally {
    await fs.rm(userDataDir, { recursive: true, force: true });
    await fs.rm(extensionsDir, { recursive: true, force: true });
  }
}

void main();
