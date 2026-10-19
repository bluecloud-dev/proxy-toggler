import { strict as assert } from 'node:assert';

import type { Memento } from '../../src/core/proxy-manager';
import { readYourWrites } from '../../src/vscode/read-your-writes-memento';
import { createMemento } from '../support/fakes';

const WINDOW_MS = 1000;

function setup() {
  const host = createMemento();
  let now = 0;
  const memento = readYourWrites(host, { windowMs: WINDOW_MS, now: () => now });
  return {
    host,
    memento,
    advance: (milliseconds: number): void => {
      now += milliseconds;
    }
  };
}

describe('readYourWrites', () => {
  it('returns the value it wrote while the host still reports an older one', async () => {
    const { host, memento } = setup();
    host.store.set('state', { enabled: false });

    await memento.update('state', { enabled: true });
    host.store.set('state', { enabled: false });

    assert.deepEqual(memento.get('state'), { enabled: true });
  });

  it('returns the latest of several writes', async () => {
    const { host, memento } = setup();

    await memento.update('state', { enabled: true });
    await memento.update('state', { enabled: false });
    host.store.set('state', { enabled: true });

    assert.deepEqual(memento.get('state'), { enabled: false });
  });

  it('defers to the host once the window has passed, so another window is still seen', async () => {
    const { host, memento, advance } = setup();
    await memento.update('state', { enabled: true });
    host.store.set('state', { enabled: false });

    advance(WINDOW_MS - 1);
    assert.deepEqual(memento.get('state'), { enabled: true });

    advance(1);
    assert.deepEqual(memento.get('state'), { enabled: false });
  });

  it('starts the window when the host acknowledges the write, not when it is requested', async () => {
    let now = 0;
    const host = createMemento();
    const slowHost: Memento = {
      get: host.get,
      update: async (key, value) => {
        now += 800;
        await host.update(key, value);
      }
    };
    const memento = readYourWrites(slowHost, { windowMs: WINDOW_MS, now: () => now });

    await memento.update('state', { enabled: true });
    host.store.set('state', { enabled: false });
    now += 300;

    assert.deepEqual(memento.get('state'), { enabled: true });
  });

  it('leaves keys it did not write to the host', async () => {
    const { host, memento } = setup();
    host.store.set('other', 'from the host');

    await memento.update('state', 1);

    assert.equal(memento.get('other'), 'from the host');
    assert.equal(memento.get('missing', 'fallback'), 'fallback');
  });

  it('returns the default for a key it cleared, even if the host still reports a value', async () => {
    const { host, memento } = setup();
    host.store.set('state', 'old');

    await memento.update('state', undefined);
    host.store.set('state', 'old');

    assert.equal(memento.get('state'), undefined);
    assert.equal(memento.get('state', 'fallback'), 'fallback');
  });

  it('does not remember a write the host rejected', async () => {
    const host = createMemento();
    host.store.set('state', 'kept');
    const failingHost: Memento = {
      get: host.get,
      update: async () => {
        throw new Error('storage unavailable');
      }
    };
    const memento = readYourWrites(failingHost);

    await assert.rejects(async () => {
      await memento.update('state', 'lost');
    }, /storage unavailable/);

    assert.equal(memento.get('state'), 'kept');
  });

  it('hands out copies, so callers cannot change what it remembers', async () => {
    const { memento } = setup();
    await memento.update('state', { enabled: true });

    const first = memento.get<{ enabled: boolean }>('state');
    if (first) {
      first.enabled = false;
    }

    assert.deepEqual(memento.get('state'), { enabled: true });
  });
});
