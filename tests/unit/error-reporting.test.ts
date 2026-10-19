import { strict as assert } from 'node:assert';

import { runInBackground } from '../../src/vscode/error-reporting';
import { createFakeVscode } from '../support/fake-vscode';
import { flushBackgroundTasks } from '../support/fakes';

describe('runInBackground', () => {
  it('logs a rejected task instead of dropping it', async () => {
    const vscode = createFakeVscode();
    const logger = vscode.window.createOutputChannel('test', { log: true });

    runInBackground(logger, 'Refresh', async () => {
      throw new Error('rejected');
    });
    await flushBackgroundTasks();

    assert.match(vscode.logs.join('\n'), /Refresh failed.*rejected/);
  });

  it('also logs a task that throws before returning its promise', async () => {
    const vscode = createFakeVscode();
    const logger = vscode.window.createOutputChannel('test', { log: true });
    const throwsSynchronously = (): Promise<void> => {
      throw new Error('thrown early');
    };

    assert.doesNotThrow(() => runInBackground(logger, 'Refresh', throwsSynchronously));
    await flushBackgroundTasks();

    assert.match(vscode.logs.join('\n'), /Refresh failed.*thrown early/);
  });
});
