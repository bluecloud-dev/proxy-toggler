import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { runTests } from '@vscode/test-electron';

import { versionsToTest } from './vscode-versions';

const extensionDevelopmentPath = path.resolve(__dirname, '..');
const extensionTestsPath = path.join(
  extensionDevelopmentPath,
  'out',
  'tests',
  'integration',
  'index.js'
);

async function main(): Promise<void> {
  for (const version of await versionsToTest()) {
    await runInFreshProfile(version);
  }
}

async function runInFreshProfile(version: string): Promise<void> {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-toggler-user-data-'));
  const extensionsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-toggler-extensions-'));

  try {
    await runTests({
      version,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--user-data-dir', userDataDir, '--extensions-dir', extensionsDir]
    });
  } finally {
    await fs.rm(userDataDir, { recursive: true, force: true });
    await fs.rm(extensionsDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error('VS Code integration tests failed.', error);
  process.exitCode = 1;
});
