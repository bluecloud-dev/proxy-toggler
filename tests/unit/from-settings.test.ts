import { strict as assert } from 'node:assert';

import { valuesFromSettings } from '../../src/core/from-settings';

describe('valuesFromSettings', () => {
  it('reads the values a profile can hold', () => {
    assert.deepEqual(
      valuesFromSettings({
        proxy: 'http://proxy.example.com:8080',
        proxyStrictSSL: false,
        noProxy: ['.corp.example.com', 'localhost']
      }),
      {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: false,
        bypassList: ['.corp.example.com', 'localhost'],
        unheld: []
      }
    );
  });

  it('removes credentials and a trailing slash, and writes out the default port', () => {
    const cases: Array<[string, string]> = [
      ['http://alice:secret@proxy.example.com:8080', 'http://proxy.example.com:8080'],
      ['http://proxy.example.com/', 'http://proxy.example.com:80'],
      ['HTTPS://Proxy.Example.com', 'https://proxy.example.com:443']
    ];

    for (const [proxy, proxyUrl] of cases) {
      assert.equal(
        valuesFromSettings({ proxy, proxyStrictSSL: undefined, noProxy: undefined }).proxyUrl,
        proxyUrl,
        proxy
      );
    }
  });

  it('names the values a profile cannot hold, without their credentials', () => {
    const values = valuesFromSettings({
      proxy: 'socks5h://alice:secret@proxy.example.com:1080',
      proxyStrictSSL: true,
      noProxy: ['10.0.0.0/8', '.corp.example.com']
    });

    assert.equal(values.proxyUrl, undefined);
    assert.deepEqual(values.bypassList, ['.corp.example.com']);
    assert.deepEqual(values.unheld, [
      'proxy URL "socks5h://proxy.example.com:1080"',
      'bypass pattern "10.0.0.0/8"'
    ]);
  });

  it('names a proxy URL with a path', () => {
    const values = valuesFromSettings({
      proxy: 'http://proxy.example.com:8080/proxy.pac',
      proxyStrictSSL: undefined,
      noProxy: undefined
    });

    assert.equal(values.proxyUrl, undefined);
    assert.deepEqual(values.unheld, ['proxy URL "http://proxy.example.com:8080/proxy.pac"']);
  });

  it('names a proxy URL it cannot read without repeating it', () => {
    const values = valuesFromSettings({
      proxy: 'not a url',
      proxyStrictSSL: undefined,
      noProxy: undefined
    });

    assert.deepEqual(values.unheld, ['the proxy URL']);
  });
});
