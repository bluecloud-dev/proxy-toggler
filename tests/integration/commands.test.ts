import { strict as assert } from 'node:assert';

import * as sinon from 'sinon';
import * as vscode from 'vscode';

type CommandPaletteItem = {
  command: string;
  when?: string;
};

type ExtensionManifest = {
  contributes?: { menus?: { commandPalette?: CommandPaletteItem[] } };
};

describe('command palette contributions', () => {
  it('registers proxy toggler commands', async () => {
    const extension = vscode.extensions.getExtension('aymenhammouda.proxy-toggler');
    assert.ok(extension, 'Expected extension to be available in VS Code test host');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('proxyToggler.configure'));
    assert.ok(commands.includes('proxyToggler.enable'));
    assert.ok(commands.includes('proxyToggler.disable'));
    assert.ok(commands.includes('proxyToggler.toggle'));
  });

  it('warns when enabling without saved configuration', async () => {
    const sandbox = sinon.createSandbox();
    const warnings: string[] = [];

    sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    sandbox.stub(vscode.window, 'showWarningMessage').callsFake(async (message: string) => {
      warnings.push(message);
      return undefined;
    });

    try {
      await vscode.commands.executeCommand('proxyToggler.enable');
    } finally {
      sandbox.restore();
    }

    assert.ok(warnings.some((message) => /no proxy configuration/i.test(message)));
  });

  it('gates enable/disable commands by proxy state context', async () => {
    const extension = vscode.extensions.getExtension('aymenhammouda.proxy-toggler');
    assert.ok(extension, 'Expected extension to be available in VS Code test host');

    const manifest = extension.packageJSON as ExtensionManifest;
    const commandPalette = manifest.contributes?.menus?.commandPalette;
    assert.ok(
      Array.isArray(commandPalette),
      'Expected contributes.menus.commandPalette to be an array'
    );

    const enable = commandPalette.find((item) => item.command === 'proxyToggler.enable');
    const disable = commandPalette.find((item) => item.command === 'proxyToggler.disable');

    assert.equal(enable?.when, 'proxyToggler.hasConfiguration && !proxyToggler.isEnabled');
    assert.equal(disable?.when, 'proxyToggler.hasConfiguration && proxyToggler.isEnabled');
  });
});
