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

  it('reads back what it wrote, creating the folder, and keeps the other keys', async () => {
    const memento = fileMemento(path.join(folder, 'global-storage', 'state.json'));

    await memento.update('first', { isEnabled: true });
    await memento.update('second', 2);

    assert.deepEqual(memento.get('first'), { isEnabled: true });
    assert.equal(memento.get('second'), 2);
  });

  it('keeps the file readable by its owner only', async function () {
    // Windows has no POSIX permission bits.
    if (process.platform === 'win32') {
      this.skip();
    }
    const file = path.join(folder, 'state.json');

    await fileMemento(file).update('key', 'value');

    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  });

  it('records nothing without a file, or with one that is not JSON', async () => {
    const file = path.join(folder, 'state.json');
    const missing = fileMemento(file).get('key', 'default');
    await fs.writeFile(file, '{ "key": ');

    assert.equal(missing, 'default');
    assert.equal(fileMemento(file).get('key'), undefined);
  });

  it('lets any other read failure through', () => {
    // A folder where the file should be cannot be read.
    assert.throws(() => fileMemento(folder).get('key'), /EISDIR/);
  });
});
