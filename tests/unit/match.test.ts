import { strict as assert } from 'node:assert';

import { settingsMatch } from '../../src/core/match';

const VALUES = {
  proxy: 'http://proxy.example.com:8080',
  proxyStrictSSL: true,
  noProxy: 'localhost,.example.com'
};

const SETTINGS = {
  proxy: 'http://proxy.example.com:8080',
  proxyStrictSSL: true,
  noProxy: ['localhost', '.example.com']
};

describe('settingsMatch', () => {
  it('matches settings that carry the same values', () => {
    assert.equal(settingsMatch(SETTINGS, VALUES), true);
  });

  it('counts an omitted port as the scheme default', () => {
    const http = { ...VALUES, proxy: 'http://proxy.example.com:80' };
    const https = { ...VALUES, proxy: 'https://proxy.example.com:443' };

    assert.equal(settingsMatch({ ...SETTINGS, proxy: 'http://proxy.example.com' }, http), true);
    assert.equal(settingsMatch({ ...SETTINGS, proxy: 'https://proxy.example.com' }, https), true);
  });

  it('counts 1080 as the default port of a socks proxy and ignores letter case in its host', () => {
    const socks = { ...VALUES, proxy: 'socks5://proxy.example.com:1080' };

    assert.equal(settingsMatch({ ...SETTINGS, proxy: 'socks5://Proxy.Example.COM' }, socks), true);
    assert.equal(settingsMatch({ ...SETTINGS, proxy: 'socks://proxy.example.com' }, socks), false);
  });

  it('ignores credentials in the proxy URL', () => {
    const settings = { ...SETTINGS, proxy: 'http://alice:secret@proxy.example.com:8080' };

    assert.equal(settingsMatch(settings, VALUES), true);
  });

  it('ignores letter case in the scheme and host', () => {
    const settings = { ...SETTINGS, proxy: 'HTTP://Proxy.EXAMPLE.com:8080' };

    assert.equal(settingsMatch(settings, VALUES), true);
  });

  it('ignores a trailing slash', () => {
    const settings = { ...SETTINGS, proxy: 'http://proxy.example.com:8080/' };

    assert.equal(settingsMatch(settings, VALUES), true);
  });

  it('counts VS Code default strict SSL as on', () => {
    const settings = { ...SETTINGS, proxyStrictSSL: undefined };

    assert.equal(settingsMatch(settings, VALUES), true);
    assert.equal(settingsMatch(settings, { ...VALUES, proxyStrictSSL: false }), false);
  });

  it('does not match a different strict SSL choice', () => {
    assert.equal(settingsMatch({ ...SETTINGS, proxyStrictSSL: false }, VALUES), false);
  });

  it('matches the same bypass patterns in any order and letter case', () => {
    const settings = { ...SETTINGS, noProxy: ['.EXAMPLE.com', 'localhost', 'localhost'] };

    assert.equal(settingsMatch(settings, VALUES), true);
  });

  it('does not match a different set of bypass patterns', () => {
    for (const noProxy of [['localhost'], ['localhost', '.example.com', '10.0.0.1'], []]) {
      assert.equal(settingsMatch({ ...SETTINGS, noProxy }, VALUES), false, noProxy.join(','));
    }
  });

  it('never matches an empty or unreadable proxy', () => {
    for (const proxy of [undefined, '', 'proxy.example.com:8080', 42]) {
      assert.equal(settingsMatch({ ...SETTINGS, proxy }, VALUES), false, String(proxy));
    }
  });

  it('does not match a different scheme, host or port', () => {
    for (const proxy of [
      'https://proxy.example.com:8080',
      'http://other.example.com:8080',
      'http://proxy.example.com:3128',
      'http://proxy.example.com'
    ]) {
      assert.equal(settingsMatch({ ...SETTINGS, proxy }, VALUES), false, proxy);
    }
  });
});
