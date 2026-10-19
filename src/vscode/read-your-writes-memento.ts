import type { Memento } from '../core/proxy-manager';

// Long enough for VS Code to catch up with a write, short enough that a change another window
// makes is still seen.
const DEFAULT_WINDOW_MS = 5000;

type Write = { value: unknown; at: number };

// VS Code sends every change of an extension's state back to the extension host, which replaces
// its in-memory value with it. The echo of an earlier write can arrive after a newer write, so for
// a moment `get` can return the older value. This serves a value from memory for a short while
// after the extension writes it, and defers to the host after that.
export function readYourWrites(
  memento: Memento,
  options: { windowMs?: number; now?: () => number } = {}
): Memento {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const now = options.now ?? ((): number => performance.now());
  const writes = new Map<string, Write>();

  const recentWrite = (key: string): Write | undefined => {
    const write = writes.get(key);
    if (write && now() - write.at >= windowMs) {
      writes.delete(key);
      return undefined;
    }
    return write;
  };

  const readYourOwn: Memento = {
    get<T>(key: string, defaultValue?: T): T | undefined {
      const write = recentWrite(key);
      if (!write) {
        return defaultValue === undefined ? memento.get<T>(key) : memento.get<T>(key, defaultValue);
      }
      return write.value === undefined ? defaultValue : (copy(write.value) as T);
    },

    async update(key: string, value: unknown): Promise<void> {
      const write: Write = { value: copy(value), at: now() };
      writes.set(key, write);
      try {
        await memento.update(key, value);
      } catch (error: unknown) {
        if (writes.get(key) === write) {
          writes.delete(key);
        }
        throw error;
      }
      write.at = now();
    }
  };

  return readYourOwn;
}

// The host stores JSON, so a copy keeps callers from changing the remembered value.
function copy(value: unknown): unknown {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown);
}
