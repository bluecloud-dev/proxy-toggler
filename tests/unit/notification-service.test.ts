import { strict as assert } from 'node:assert';

import { NotificationService } from '../../src/vscode/notification-service';
import { createFakeVscode } from '../support/fake-vscode';

const ACTION_A = { id: 'a', title: 'Action A' };
const ACTION_B = { id: 'b', title: 'Action B' };

describe('NotificationService', () => {
  const cases = [
    ['showSuccess', 'info'],
    ['showWarning', 'warning'],
    ['showError', 'error']
  ] as const;

  for (const [method, kind] of cases) {
    it(`${method} localizes the message and actions and returns the clicked action id`, async () => {
      const vscode = createFakeVscode({
        translate: (message) => `t:${message}`,
        answer: (message) => message.items[1]
      });

      const selected = await new NotificationService(vscode)[method]('Hello', ACTION_A, ACTION_B);

      assert.equal(selected, 'b');
      assert.deepEqual(vscode.messages, [
        { kind, message: 't:Hello', items: ['t:Action A', 't:Action B'] }
      ]);
    });
  }

  it('returns undefined when the notification is dismissed', async () => {
    const vscode = createFakeVscode();

    assert.equal(await new NotificationService(vscode).showWarning('Hello', ACTION_A), undefined);
  });
});
