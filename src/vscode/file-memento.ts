import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Memento } from '../core/proxy-manager';

// A Memento kept in a JSON file, for state that must stay on the machine whose settings it
// describes: a remote machine's record lives in the extension's global storage there, shared by
// every window connected to it (ADR 0005). Each read goes to the file, so a write from another
// window shows at once.
export function fileMemento(file: string): Memento {
  const read = (): Record<string, unknown> => {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    } catch {
      // No file yet, or one that another write is replacing: nothing recorded.
      return {};
    }
  };

  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      const value = read()[key] as T | undefined;
      return value === undefined ? defaultValue : value;
    },

    // A whole file replaces the old one, so a reader never sees half a write. The file is small,
    // and writing it at once keeps two changes in this window from interleaving.
    update(key: string, value: unknown): Promise<void> {
      try {
        const values = { ...read(), [key]: value };
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(values));
        fs.renameSync(temporary, file);
        return Promise.resolve();
      } catch (error: unknown) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
}
