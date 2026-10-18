import { strict as assert } from 'node:assert';

import { StatusBarController } from '../../src/vscode/status-bar-controller';
import { createFakeVscode } from '../support/fake-vscode';

describe('StatusBarController', () => {
  it('creates one right-aligned item that runs the toggle command', () => {
    const vscode = createFakeVscode();

    new StatusBarController(vscode, 'proxyToggler.toggle');

    const [item] = vscode.statusBarItems;
    assert.equal(vscode.statusBarItems.length, 1);
    assert.equal(item?.alignment, vscode.StatusBarAlignment.Right);
    assert.equal(item?.priority, 100);
    assert.equal(item?.command, 'proxyToggler.toggle');
  });

  it('renders each state with an accessible label', () => {
    const vscode = createFakeVscode();
    const controller = new StatusBarController(vscode, 'proxyToggler.toggle');

    const rendered = [
      { isEnabled: false, hasConfiguration: false },
      { isEnabled: false, hasConfiguration: true },
      { isEnabled: true, hasConfiguration: true }
    ].map((state) => {
      controller.updateState(state);
      return [controller.getText(), controller.getAccessibilityLabel()];
    });

    assert.deepEqual(rendered, [
      ['$(warning) Proxy: Not Configured', 'Proxy status: not configured'],
      ['$(debug-disconnect) Proxy: OFF', 'Proxy status: disabled'],
      ['$(plug) Proxy: ON', 'Proxy status: enabled']
    ]);
  });

  it('disposes its item', () => {
    const vscode = createFakeVscode();
    const controller = new StatusBarController(vscode, 'proxyToggler.toggle');

    controller.dispose();

    assert.equal(vscode.statusBarItems[0]?.disposeCalls, 1);
  });
});
