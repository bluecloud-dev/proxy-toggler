import { strict as assert } from 'node:assert';

import {
  validateBypassPattern,
  validateProxyUrl,
  ValidationError
} from '../../src/core/validation';

function captureValidationError(operation: () => void): ValidationError {
  try {
    operation();
  } catch (error: unknown) {
    assert.ok(error instanceof ValidationError);
    return error;
  }

  assert.fail('Expected ValidationError to be thrown');
}

describe('validation', () => {
  describe('validateProxyUrl', () => {
    it('accepts valid http/https URLs with ports', () => {
      assert.doesNotThrow(() => validateProxyUrl('http://proxy.example.com:8080'));
      assert.doesNotThrow(() => validateProxyUrl('https://10.0.0.1:3128'));
      assert.doesNotThrow(() => validateProxyUrl('http://[::1]:8080'));
      assert.doesNotThrow(() => validateProxyUrl('HTTP://proxy.example.com:8080'));
      assert.doesNotThrow(() => validateProxyUrl('http://proxy.example.com:443'));
      assert.doesNotThrow(() => validateProxyUrl('https://proxy.example.com:80'));
    });

    for (const url of [
      'http://proxy.example.com:80',
      'https://proxy.example.com:443',
      'http://[::1]:80',
      'HTTP://proxy.example.com:80'
    ]) {
      it(`accepts ${url}, whose port is the scheme default`, () => {
        assert.doesNotThrow(() => validateProxyUrl(url));
      });
    }

    it('rejects missing or malformed URLs', () => {
      const emptyError = captureValidationError(() => validateProxyUrl(''));
      assert.equal(emptyError.field, 'proxyUrl');

      const whitespaceError = captureValidationError(() => validateProxyUrl('   '));
      assert.equal(whitespaceError.field, 'proxyUrl');

      const notStringError = captureValidationError(() =>
        validateProxyUrl(null as unknown as string)
      );
      assert.equal(notStringError.field, 'proxyUrl');

      const noSchemeError = captureValidationError(() =>
        validateProxyUrl('proxy.example.com:8080')
      );
      assert.equal(noSchemeError.field, 'proxyUrl');
      assert.match(noSchemeError.reason, /scheme/i);
    });

    it('rejects unsupported schemes', () => {
      const error = captureValidationError(() => validateProxyUrl('ftp://proxy.example.com:8080'));

      assert.equal(error.field, 'proxyUrl');
      assert.match(error.reason, /scheme/i);
    });

    it('accepts socks and socks5 URLs with ports', () => {
      assert.doesNotThrow(() => validateProxyUrl('socks://proxy.example.com:1080'));
      assert.doesNotThrow(() => validateProxyUrl('socks5://Proxy.Example.com:1080'));
      assert.doesNotThrow(() => validateProxyUrl('socks5://10.0.0.1:9050'));
    });

    it('refuses socks4, socks4a and socks5h, naming them and saying why', () => {
      for (const scheme of ['socks4', 'socks4a', 'socks5h']) {
        const error = captureValidationError(() =>
          validateProxyUrl(`${scheme}://proxy.example.com:1080`)
        );
        assert.match(error.reason, /socks4, socks4a and socks5h/, scheme);
        assert.match(error.reason, /host names/, scheme);
      }
    });

    it('checks a socks URL like any other: port, credentials, path', () => {
      for (const url of [
        'socks5://proxy.example.com',
        'socks5://alice:secret@proxy.example.com:1080',
        'socks5://proxy.example.com:1080/path',
        'socks5://proxy.example.com:1080/'
      ]) {
        assert.throws(() => validateProxyUrl(url), ValidationError, url);
      }
    });

    it('rejects missing port numbers and invalid port ranges', () => {
      const missingPortError = captureValidationError(() =>
        validateProxyUrl('http://proxy.example.com')
      );
      assert.equal(missingPortError.field, 'proxyUrl');
      assert.match(missingPortError.reason, /port/i);

      const zeroPortError = captureValidationError(() =>
        validateProxyUrl('http://proxy.example.com:0')
      );
      assert.equal(zeroPortError.field, 'proxyUrl');

      const tooHighPortError = captureValidationError(() =>
        validateProxyUrl('http://proxy.example.com:65536')
      );
      assert.equal(tooHighPortError.field, 'proxyUrl');
    });

    it('still requires a port when none is typed', () => {
      for (const url of [
        'http://proxy.example.com',
        'https://proxy.example.com',
        'http://proxy.example.com:',
        'http://[::1]'
      ]) {
        const error = captureValidationError(() => validateProxyUrl(url));
        assert.equal(error.reason, 'Port number is required', url);
      }
    });

    it('rejects credentials embedded in the URL', () => {
      const error = captureValidationError(() =>
        validateProxyUrl('http://user:pass@proxy.example.com:8080')
      );
      assert.equal(error.field, 'proxyUrl');
      assert.match(error.reason, /credentials/i);
    });

    it('reports credentials, not the port, in a URL with a default port', () => {
      const error = captureValidationError(() =>
        validateProxyUrl('http://user:pass@proxy.example.com:80')
      );
      assert.match(error.reason, /credentials/i);
    });

    it('rejects paths, queries, and fragments', () => {
      const trailingSlashError = captureValidationError(() =>
        validateProxyUrl('http://proxy.example.com:8080/')
      );
      assert.equal(trailingSlashError.field, 'proxyUrl');

      const pathError = captureValidationError(() =>
        validateProxyUrl('http://proxy.example.com:8080/path')
      );
      assert.equal(pathError.field, 'proxyUrl');

      const queryError = captureValidationError(() =>
        validateProxyUrl('http://proxy.example.com:8080?foo=bar')
      );
      assert.equal(queryError.field, 'proxyUrl');

      const fragmentError = captureValidationError(() =>
        validateProxyUrl('http://proxy.example.com:8080#frag')
      );
      assert.equal(fragmentError.field, 'proxyUrl');
    });

    it('reports a path after a default port as a path, not as a missing port', () => {
      const trailingSlashError = captureValidationError(() =>
        validateProxyUrl('http://proxy.example.com:80/')
      );
      assert.match(trailingSlashError.reason, /path/i);

      const pathError = captureValidationError(() =>
        validateProxyUrl('https://proxy.example.com:443/proxy')
      );
      assert.match(pathError.reason, /path/i);
    });
  });

  describe('validateBypassPattern', () => {
    it('accepts hostnames, IP literals, domain suffixes, and *.-wildcards', () => {
      for (const pattern of ['localhost', '127.0.0.1', '.example.com', '*.local', '::1']) {
        assert.doesNotThrow(() => validateBypassPattern(pattern), pattern);
      }
    });

    it('rejects CIDR patterns (out of scope for v1)', () => {
      const error = captureValidationError(() => validateBypassPattern('10.0.0.0/8'));
      assert.equal(error.field, 'noProxy');
      assert.match(error.reason, /cidr/i);
    });

    it('rejects schemes and invalid wildcard patterns', () => {
      const schemeError = captureValidationError(() => validateBypassPattern('http://localhost'));
      assert.equal(schemeError.field, 'noProxy');

      for (const pattern of ['**.example.com', 'example.*.com', '*..example.com']) {
        assert.throws(() => validateBypassPattern(pattern), ValidationError, pattern);
      }
    });

    it('rejects invalid bypass entries', () => {
      for (const pattern of ['.', 'user@host', 'example.com:8080', 'local host', '*.127.0.0.1']) {
        assert.throws(() => validateBypassPattern(pattern), ValidationError, pattern);
      }
    });
  });
});
