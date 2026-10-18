import { strict as assert } from 'node:assert';

import { NotificationService } from '../../src/ui/notification-service';
import type { NotificationAction } from '../../src/ui/notification-service';

describe('NotificationService', () => {
  it('localizes message and actions and returns selected action id', async () => {
    const infoCalls: Array<{ message: string; items: string[] }> = [];

    const vscodeApi = {
      l10n: {
        t: (message: string): string => `t:${message}`
      },
      window: {
        showInformationMessage: async (
          message: string,
          ...items: string[]
        ): Promise<string | undefined> => {
          infoCalls.push({ message, items });
          return items[1];
        },
        showWarningMessage: async (): Promise<string | undefined> => undefined,
        showErrorMessage: async (): Promise<string | undefined> => undefined
      }
    };

    const actionA: NotificationAction = { id: 'a', title: 'Action A' };
    const actionB: NotificationAction = { id: 'b', title: 'Action B' };

    const service = new NotificationService(vscodeApi);
    const selected = await service.showSuccess('Hello', actionA, actionB);

    assert.equal(selected, 'b');
    assert.equal(infoCalls.length, 1);
    assert.equal(infoCalls[0]?.message, 't:Hello');
    assert.deepEqual(infoCalls[0]?.items, ['t:Action A', 't:Action B']);
  });

  it('maps warning selections back to action ids', async () => {
    const warningCalls: Array<{ message: string; items: string[] }> = [];

    const vscodeApi = {
      l10n: {
        t: (message: string): string => `t:${message}`
      },
      window: {
        showInformationMessage: async (): Promise<string | undefined> => undefined,
        showWarningMessage: async (
          message: string,
          ...items: string[]
        ): Promise<string | undefined> => {
          warningCalls.push({ message, items });
          return items[0];
        },
        showErrorMessage: async (): Promise<string | undefined> => undefined
      }
    };

    const action: NotificationAction = { id: 'open', title: 'Open Settings' };
    const service = new NotificationService(vscodeApi);
    const selected = await service.showWarning('Warning', action);

    assert.equal(selected, 'open');
    assert.equal(warningCalls.length, 1);
    assert.equal(warningCalls[0]?.message, 't:Warning');
    assert.deepEqual(warningCalls[0]?.items, ['t:Open Settings']);
  });

  it('maps error selections back to action ids', async () => {
    const errorCalls: Array<{ message: string; items: string[] }> = [];

    const vscodeApi = {
      l10n: {
        t: (message: string): string => `t:${message}`
      },
      window: {
        showInformationMessage: async (): Promise<string | undefined> => undefined,
        showWarningMessage: async (): Promise<string | undefined> => undefined,
        showErrorMessage: async (
          message: string,
          ...items: string[]
        ): Promise<string | undefined> => {
          errorCalls.push({ message, items });
          return items[1];
        }
      }
    };

    const actionA: NotificationAction = { id: 'settings', title: 'Open Settings' };
    const actionB: NotificationAction = { id: 'disable', title: 'Disable Proxy' };
    const service = new NotificationService(vscodeApi);
    const selected = await service.showError('Error', actionA, actionB);

    assert.equal(selected, 'disable');
    assert.equal(errorCalls.length, 1);
    assert.equal(errorCalls[0]?.message, 't:Error');
    assert.deepEqual(errorCalls[0]?.items, ['t:Open Settings', 't:Disable Proxy']);
  });
});
