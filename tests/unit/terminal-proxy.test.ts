import { strict as assert } from 'node:assert';

import { terminalProxyVariables } from '../../src/core/terminal-proxy';

const LOOPBACK = 'localhost,127.0.0.1,::1,::ffff:127.0.0.1';

describe('terminalProxyVariables', () => {
  it('sets the proxy in both cases, since curl, and so Git, reads only http_proxy for http', () => {
    assert.deepEqual(
      terminalProxyVariables({
        proxy: 'http://proxy.example.com:8080',
        proxyStrictSSL: true,
        noProxy: undefined
      }),
      {
        http_proxy: 'http://proxy.example.com:8080',
        https_proxy: 'http://proxy.example.com:8080',
        HTTP_PROXY: 'http://proxy.example.com:8080',
        HTTPS_PROXY: 'http://proxy.example.com:8080',
        no_proxy: LOOPBACK,
        NO_PROXY: LOOPBACK
      }
    );
  });

  it('sets nothing when VS Code uses no proxy from its settings', () => {
    for (const proxy of [undefined, '', '  ', 'not a url', 42]) {
      assert.deepEqual(
        terminalProxyVariables({ proxy, proxyStrictSSL: true, noProxy: ['example.com'] }),
        {}
      );
    }
  });

  it('never passes on credentials that http.proxy holds', () => {
    const variables = terminalProxyVariables({
      proxy: 'http://alice:secret@proxy.example.com:8080/',
      proxyStrictSSL: true,
      noProxy: undefined
    });

    assert.equal(variables.HTTPS_PROXY, 'http://proxy.example.com:8080');
    assert.ok(Object.values(variables).every((value) => !value.includes('secret')));
  });

  it('bypasses loopback addresses as extensions do, then the bypass list, without repeats', () => {
    const variables = terminalProxyVariables({
      proxy: 'http://proxy.example.com:8080',
      proxyStrictSSL: true,
      noProxy: ['localhost', '.corp.example.com', '10.0.0.1']
    });

    assert.equal(variables.NO_PROXY, `${LOOPBACK},.corp.example.com,10.0.0.1`);
    assert.equal(variables.no_proxy, variables.NO_PROXY);
  });

  it('writes "*.x" as ".x", the subdomain form command-line tools understand', () => {
    const variables = terminalProxyVariables({
      proxy: 'http://proxy.example.com:8080',
      proxyStrictSSL: true,
      noProxy: '*.example.com'
    });

    assert.equal(variables.NO_PROXY, `${LOOPBACK},.example.com`);
  });

  it('never turns off certificate checks, whatever http.proxyStrictSSL says', () => {
    const variables = terminalProxyVariables({
      proxy: 'http://proxy.example.com:8080',
      proxyStrictSSL: false,
      noProxy: undefined
    });

    assert.deepEqual(Object.keys(variables).sort(), [
      'HTTPS_PROXY',
      'HTTP_PROXY',
      'NO_PROXY',
      'http_proxy',
      'https_proxy',
      'no_proxy'
    ]);
  });
});
