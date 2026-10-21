import { strict as assert } from 'node:assert';

import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { activateExtension, dismissNotifications, EXTENSION_ID } from './support';

type ExtensionManifest = {
  contributes?: { configuration?: { properties?: Record<string, { scope?: string }> } };
};

const LAB = {
  name: 'Lab',
  proxyUrl: 'http://lab.example.com:3128',
  strictSSL: true,
  bypassList: ['.lab.example.com']
};

const settings = (section: string): vscode.WorkspaceConfiguration =>
  vscode.workspace.getConfiguration(section);

describe('proxy profiles', function () {
  this.timeout(20000);

  const sandbox = sinon.createSandbox();
  let profilesBefore: unknown;

  before(() => {
    profilesBefore = settings('proxyToggler').inspect('profiles')?.globalValue;
  });
  beforeEach(() => dismissNotifications(sandbox));
  afterEach(() => sandbox.restore());
  after(async () => {
    await settings('proxyToggler').update(
      'profiles',
      profilesBefore,
      vscode.ConfigurationTarget.Global
    );
  });

  it('declares proxyToggler.profiles as an application setting', () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    const manifest = extension?.packageJSON as ExtensionManifest | undefined;

    assert.equal(
      manifest?.contributes?.configuration?.properties?.['proxyToggler.profiles']?.scope,
      'application'
    );
  });

  it('turns a profile from the settings on and off', async () => {
    await activateExtension();
    await settings('proxyToggler').update('profiles', [LAB], vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('proxyToggler.disable');

    await vscode.commands.executeCommand('proxyToggler.toggle');
    const whenOn = {
      proxy: settings('http').inspect<string>('proxy')?.globalValue,
      noProxy: settings('http').inspect<string[]>('noProxy')?.globalValue
    };
    await vscode.commands.executeCommand('proxyToggler.toggle');

    assert.deepEqual(whenOn, { proxy: LAB.proxyUrl, noProxy: LAB.bypassList });
    assert.equal(settings('http').inspect<string>('proxy')?.globalValue, undefined);
  });
});
