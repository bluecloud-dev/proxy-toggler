import { strict as assert } from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { fileMemento } from '../../src/vscode/file-memento';

describe('fileMemento', () => {
  let folder: string;

  beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-toggler-file-memento-'));
  });
  afterEach(() => fs.rm(folder, { recursive: true, force: true }));

  it('reads back what it wrote, creating the folder', async () => {
    const memento = fileMemento(path.join(folder, 'global-storage'));

    await memento.update('proxyToggler.state', { isEnabled: true });

    assert.deepEqual(memento.get('proxyToggler.state'), { isEnabled: true });
  });

  it('keeps each key in a file of its own, so a write never rewrites another key', async () => {
    // Two windows connected to the same machine, each writing its own key.
    const first = fileMemento(folder);
    const second = fileMemento(folder);

    await first.update('first', { isEnabled: true });
    await second.update('second', 2);

    assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder, 'first.json'), 'utf8')), {
      isEnabled: true
    });
    assert.equal(JSON.parse(await fs.readFile(path.join(folder, 'second.json'), 'utf8')), 2);
    assert.deepEqual(first.get('first'), { isEnabled: true });
    assert.equal(first.get('second'), 2);
  });

  it('removes the file of a key set to undefined', async () => {
    const memento = fileMemento(folder);
    await memento.update('key', 'value');

    await memento.update('key', undefined);

    assert.equal(memento.get('key'), undefined);
    assert.deepEqual(await fs.readdir(folder), []);
  });

  it('keeps each file readable by its owner only', async function () {
    // Windows has no POSIX permission bits.
    if (process.platform === 'win32') {
      this.skip();
    }

    await fileMemento(folder).update('key', 'value');

    assert.equal((await fs.stat(path.join(folder, 'key.json'))).mode & 0o777, 0o600);
  });

  it('records nothing without a file, or with one that is not JSON', async () => {
    const missing = fileMemento(folder).get('key', 'default');
    await fs.writeFile(path.join(folder, 'key.json'), '{ "key": ');

    assert.equal(missing, 'default');
    assert.equal(fileMemento(folder).get('key'), undefined);
  });

  it('lets any other read failure through', async () => {
    // A folder where the file should be cannot be read.
    await fs.mkdir(path.join(folder, 'key.json'));

    assert.throws(() => fileMemento(folder).get('key'), /EISDIR/);
  });
});
