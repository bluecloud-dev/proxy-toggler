import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { runVSCodeCommand } from '@vscode/test-electron';

import { makeTempDir, removeTempDir } from './temp-dir';
import { versionsToTest } from './vscode-versions';

const root = path.resolve(__dirname, '..');

// The launch flags runTests uses, without --disable-workspace-trust.
const LAUNCH_FLAGS = [
  '--no-sandbox',
  '--disable-gpu-sandbox',
  '--disable-updates',
  '--skip-welcome',
  '--skip-release-notes',
  '--no-cached-data'
];

async function main(): Promise<void> {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  // Built by npm run package.
  const vsix = path.join(root, `${manifest.name}-${manifest.version}.vsix`);
  await fs.access(vsix);

  for (const version of await versionsToTest()) {
    await runInRestrictedMode(version, vsix);
  }
}

// Extensions loaded with --extensionDevelopmentPath ignore Workspace Trust, so only an installed
// package shows whether the manifest's trust declaration works. VS Code runs extension tests only
// in a development host, so an empty development extension loads the tests.
async function runInRestrictedMode(version: string, vsix: string): Promise<void> {
  const temp = await makeTempDir('pkg');
  const userDataDir = path.join(temp, 'user-data');
  const profile = [
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${path.join(temp, 'extensions')}`
  ];
  const untrustedFolder = path.join(temp, 'workspace');

  try {
    await fs.mkdir(path.join(userDataDir, 'User'), { recursive: true });
    await fs.mkdir(untrustedFolder);
    // Without the startup prompt, a folder nobody has trusted opens in Restricted Mode.
    await fs.writeFile(
      path.join(userDataDir, 'User', 'settings.json'),
      JSON.stringify({ 'security.workspace.trust.startupPrompt': 'never' })
    );

    await runVSCodeCommand(['--install-extension', vsix, ...profile], { version });
    await runVSCodeCommand(
      [
        ...LAUNCH_FLAGS,
        `--extensionDevelopmentPath=${path.join(root, 'tests', 'packaged', 'host')}`,
        `--extensionTestsPath=${path.join(root, 'out', 'tests', 'packaged', 'index.js')}`,
        ...profile,
        untrustedFolder
      ],
      { version }
    );
    console.log(`The packaged extension works in Restricted Mode on VS Code ${version}.`);
  } finally {
    await removeTempDir(temp);
  }
}

// runVSCodeCommand, unlike runTests, leaves VS Code's output pipes open, and on Windows they can
// keep Node alive after the tests are done, so the process exits explicitly.
main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error('Packaged extension tests failed.', error);
    process.exit(1);
  }
);
