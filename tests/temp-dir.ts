import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// VS Code creates a unix socket inside its user data directory, and macOS limits socket paths to
// 103 characters, so the names stay short.
export function makeTempDir(label: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `pt-${label}-`));
}

// On Windows, files that VS Code used can stay locked for a moment after it exits, so removal
// retries. A directory that cannot be removed is only a leftover, so it must not replace the
// result of the test run.
export async function removeTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  } catch (error: unknown) {
    console.warn(`Could not remove ${dir}.`, error);
  }
}
