import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// The engines.vscode minimum catches use of newer APIs; stable catches host regressions.
export async function versionsToTest(): Promise<string[]> {
  const manifestPath = path.resolve(__dirname, '..', 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
    engines: { vscode: string };
  };
  const minimum = manifest.engines.vscode.replace(/^[^\d]*/, '');
  return [minimum, 'stable'];
}
