import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Memento } from '../core/proxy-manager';

// A Memento kept in a folder, for state that must stay on the machine whose settings it
// describes: a remote machine's record lives in the extension's global storage there, shared by
// every window connected to it (ADR 0005). Each key has a file of its own, so a window that
// writes one key never rewrites another; for one key the last write wins, as in globalState, and
// reconciliation brings the record back in step with the settings. Each read goes to the file,
// so a write from another window shows at once.
export function fileMemento(folder: string): Memento {
  const fileOf = (key: string): string => path.join(folder, `${encodeURIComponent(key)}.json`);

  const read = (key: string): unknown => {
    let text: string;
    try {
      text = fs.readFileSync(fileOf(key), 'utf8');
    } catch (error: unknown) {
      // No file yet: nothing recorded.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error: unknown) {
      // A file that is not JSON, such as one edited by hand, records nothing.
      if (error instanceof SyntaxError) {
        return undefined;
      }
      throw error;
    }
  };

  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      const value = read(key) as T | undefined;
      return value === undefined ? defaultValue : value;
    },

    // A whole file replaces the old one, so a reader never sees half a write. The file is small,
    // and writing it at once keeps two changes in this window from interleaving. The new file is
    // created exclusively, so a file or link already at its name is never written through, and
    // only its owner can read it.
    update(key: string, value: unknown): Promise<void> {
      try {
        const file = fileOf(key);
        if (value === undefined) {
          fs.rmSync(file, { force: true });
          return Promise.resolve();
        }
        fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
        const temporary = `${file}.${randomUUID()}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
        return Promise.resolve();
      } catch (error: unknown) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
}
