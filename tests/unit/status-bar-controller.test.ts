import { strict as assert } from 'node:assert';

import { StatusBarController } from '../../src/vscode/status-bar-controller';
import { createFakeVscode } from '../support/fake-vscode';

describe('StatusBarController', () => {
  it('creates the toggle and, to its right, the gear that opens the switcher', () => {
    const vscode = createFakeVscode();

    new StatusBarController(vscode, 'proxyToggler.toggle', 'proxyToggler.switchProfile');

    const [item, gear] = vscode.statusBarItems;
    assert.equal(vscode.statusBarItems.length, 2);
    assert.equal(item?.alignment, vscode.StatusBarAlignment.Right);
    assert.equal(item?.priority, 100);
    assert.equal(item?.command, 'proxyToggler.toggle');
    assert.equal(gear?.priority, 99);
    assert.equal(gear?.command, 'proxyToggler.switchProfile');
  });

  it('renders each state with an accessible label', () => {
    const vscode = createFakeVscode();
    const controller = new StatusBarController(
      vscode,
      'proxyToggler.toggle',
      'proxyToggler.switchProfile'
    );

    const work = {
      name: 'Work',
      proxyUrl: 'http://proxy.example.com:8080',
      strictSSL: true,
      bypassList: []
    };
    const rendered = [
      { isEnabled: false, hasConfiguration: false },
      { isEnabled: false, hasConfiguration: true, currentProfile: work },
      { isEnabled: true, hasConfiguration: true, currentProfile: work }
    ].map((state) => {
      controller.updateState(state, { profileCount: 1, drift: false, settingsHoldProxy: false });
      return [controller.getText(), controller.getAccessibilityLabel()];
    });

    assert.deepEqual(rendered, [
      ['$(warning) Proxy: Not Configured', 'Proxy not configured'],
      ['$(debug-disconnect) Proxy: OFF', 'Proxy off, profile Work'],
      ['$(plug) Proxy: ON', 'Proxy on, profile Work']
    ]);
  });

  it('disposes its items', () => {
    const vscode = createFakeVscode();
    const controller = new StatusBarController(
      vscode,
      'proxyToggler.toggle',
      'proxyToggler.switchProfile'
    );

    controller.dispose();

    assert.deepEqual(
      vscode.statusBarItems.map((item) => item.disposeCalls),
      [1, 1]
    );
  });
});
