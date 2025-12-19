import { strict as assert } from 'node:assert';

import type { StatusBarAlignment } from 'vscode';

import { StatusBarController } from '../../src/ui/status-bar-controller';

describe('StatusBarController', () => {
  it('creates a right-aligned status bar item and updates state text', () => {
    const createCalls: Array<{ alignment: StatusBarAlignment; priority?: number }> = [];
    const item = {
      text: '',
      tooltip: undefined as string | undefined,
      command: undefined as string | undefined,
      accessibilityInformation: undefined,
      showCalls: 0,
      show: (): void => {
        item.showCalls += 1;
      },
      disposeCalls: 0,
      dispose: (): void => {
        item.disposeCalls += 1;
      }
    };

    const vscodeApi = {
      StatusBarAlignment: { Right: 2 as unknown as StatusBarAlignment },
      l10n: { t: (message: string): string => message },
      window: {
        createStatusBarItem: (alignment: StatusBarAlignment, priority?: number) => {
          createCalls.push({ alignment, priority });
          return item;
        }
      }
    };

    const controller = new StatusBarController(vscodeApi, 'proxyToggler.toggle');
    controller.initialize();

    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].alignment, 2 as unknown as StatusBarAlignment);
    assert.equal(createCalls[0].priority, 100);
    assert.equal(item.command, 'proxyToggler.toggle');

    controller.updateState({ isEnabled: false, hasConfiguration: false });
    assert.match(item.text, /not configured/i);

    controller.updateState({ isEnabled: false, hasConfiguration: true });
    assert.match(item.text, /off/i);

    controller.updateState({ isEnabled: true, hasConfiguration: true });
    assert.match(item.text, /on/i);

    controller.dispose();
    assert.equal(item.disposeCalls, 1);
  });
});
