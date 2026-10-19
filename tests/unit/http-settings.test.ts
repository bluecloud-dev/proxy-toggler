import { strict as assert } from 'node:assert';

import { createHttpSettings } from '../../src/vscode/http-settings';
import { createFakeVscode } from '../support/fake-vscode';

describe('createHttpSettings', () => {
  it('reads the effective http.* values', () => {
    const vscode = createFakeVscode({
      settings: { 'http.proxy': 'http://proxy:8080', 'http.noProxy': ['localhost'] }
    });

    assert.deepEqual(createHttpSettings(vscode).read(), {
      proxy: 'http://proxy:8080',
      proxyStrictSSL: undefined,
      noProxy: ['localhost']
    });
  });

  it('reads user settings without the defaults that the effective values include', () => {
    const vscode = createFakeVscode({
      settings: { 'http.proxy': 'http://proxy:8080' },
      defaults: { 'http.proxyStrictSSL': true, 'http.noProxy': [] }
    });
    const httpSettings = createHttpSettings(vscode);

    assert.deepEqual(httpSettings.read(), {
      proxy: 'http://proxy:8080',
      proxyStrictSSL: true,
      noProxy: []
    });
    assert.deepEqual(httpSettings.readUserSettings(), {
      proxy: 'http://proxy:8080',
      proxyStrictSSL: undefined,
      noProxy: undefined
    });
  });

  it('writes user (global) settings', async () => {
    const vscode = createFakeVscode();

    await createHttpSettings(vscode).update('proxy', 'http://proxy:8080');

    assert.deepEqual(vscode.settingUpdates, [
      { id: 'http.proxy', value: 'http://proxy:8080', target: vscode.ConfigurationTarget.Global }
    ]);
  });

  it('writes the comma-separated bypass list as the array VS Code expects', async () => {
    const vscode = createFakeVscode();

    await createHttpSettings(vscode).update('noProxy', 'localhost, 127.0.0.1');

    assert.deepEqual(vscode.settings.get('http.noProxy'), ['localhost', '127.0.0.1']);
  });

  it('clears a setting by writing undefined', async () => {
    const vscode = createFakeVscode({ settings: { 'http.noProxy': ['localhost'] } });

    await createHttpSettings(vscode).update('noProxy', undefined);

    assert.equal(vscode.settings.has('http.noProxy'), false);
  });
});
