import * as path from 'node:path';

import { runTests } from '@vscode/test-electron';

import { makeTempDir, removeTempDir } from './temp-dir';
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
  const userDataDir = await makeTempDir('data');
  const extensionsDir = await makeTempDir('ext');

  try {
    await runTests({
      version,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--user-data-dir', userDataDir, '--extensions-dir', extensionsDir]
    });
  } finally {
    await removeTempDir(userDataDir);
    await removeTempDir(extensionsDir);
  }
}

main().catch((error: unknown) => {
  console.error('VS Code integration tests failed.', error);
  process.exitCode = 1;
});
