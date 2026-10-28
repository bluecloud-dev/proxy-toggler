import { strict as assert } from 'node:assert';

import { createCommandRegistrar, runInBackground } from '../../src/vscode/error-reporting';
import { createFakeVscode } from '../support/fake-vscode';
import { createNotificationRecorder, flushBackgroundTasks } from '../support/fakes';

describe('createCommandRegistrar', () => {
  it("shows an error's own user message, or the command's fallback", async () => {
    const vscode = createFakeVscode();
    const recorder = createNotificationRecorder();
    const register = createCommandRegistrar(
      vscode,
      vscode.window.createOutputChannel('test', { log: true }),
      recorder
    );
    register('test.explained', 'Failed to test.', async () => {
      throw Object.assign(new Error('raw'), { toUserMessage: () => 'Explained.' });
    });
    register('test.unexplained', 'Failed to test.', async () => {
      throw new Error('raw');
    });

    await vscode.commandHandlers.get('test.explained')?.();
    await vscode.commandHandlers.get('test.unexplained')?.();

    assert.deepEqual(
      recorder.notifications.map(({ kind, message }) => [kind, message]),
      [
        ['error', 'Explained.'],
        ['error', 'Failed to test.']
      ]
    );
  });
});

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
