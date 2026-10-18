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

  it('writes user (global) settings', async () => {
    const vscode = createFakeVscode();

    await createHttpSettings(vscode).update('proxy', 'http://proxy:8080');

    assert.deepEqual(vscode.settingUpdates, [
      { id: 'http.proxy', value: 'http://proxy:8080', target: vscode.ConfigurationTarget.Global }
    ]);
  });

  it('writes noProxy in the shape of the VS Code schema', async () => {
    const arrayShaped = createFakeVscode({ settingDefaults: { 'http.noProxy': [] } });
    const stringShaped = createFakeVscode();

    await createHttpSettings(arrayShaped).update('noProxy', 'localhost, 127.0.0.1');
    await createHttpSettings(stringShaped).update('noProxy', 'localhost, 127.0.0.1');

    assert.deepEqual(arrayShaped.settings.get('http.noProxy'), ['localhost', '127.0.0.1']);
    assert.equal(stringShaped.settings.get('http.noProxy'), 'localhost, 127.0.0.1');
  });
});
