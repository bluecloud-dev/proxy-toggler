import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { runTests } from '@vscode/test-electron';

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

// The engines.vscode minimum catches use of newer APIs; stable catches host regressions.
async function versionsToTest(): Promise<string[]> {
  const manifestPath = path.join(extensionDevelopmentPath, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
    engines: { vscode: string };
  };
  const minimum = manifest.engines.vscode.replace(/^[^\d]*/, '');
  return [minimum, 'stable'];
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
