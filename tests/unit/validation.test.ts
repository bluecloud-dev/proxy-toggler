import { strict as assert } from 'node:assert';

import {
  validateCredentials,
  validateNoProxyList,
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
    });

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

    it('rejects credentials embedded in the URL', () => {
      const error = captureValidationError(() =>
        validateProxyUrl('http://user:pass@proxy.example.com:8080')
      );
      assert.equal(error.field, 'proxyUrl');
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
  });

  describe('validateCredentials', () => {
    it('accepts both omitted and both provided', () => {
      assert.doesNotThrow(() => validateCredentials(undefined, undefined));
      assert.doesNotThrow(() => validateCredentials('alice', 'secret'));
      assert.doesNotThrow(() => validateCredentials('', ''));
      assert.doesNotThrow(() => validateCredentials('   ', '   '));
    });

    it('rejects mismatched username/password pairing', () => {
      const usernameOnlyError = captureValidationError(() =>
        validateCredentials('alice', undefined)
      );
      assert.equal(usernameOnlyError.field, 'credentials');

      const passwordOnlyError = captureValidationError(() =>
        validateCredentials(undefined, 'secret')
      );
      assert.equal(passwordOnlyError.field, 'credentials');

      assert.throws(() => validateCredentials('alice', ''), ValidationError);
      assert.throws(() => validateCredentials('', 'secret'), ValidationError);
    });
  });

  describe('validateNoProxyList', () => {
    it('accepts empty or undefined patterns', () => {
      assert.doesNotThrow(() => validateNoProxyList());
      assert.doesNotThrow(() => validateNoProxyList(''));
      assert.doesNotThrow(() => validateNoProxyList('   '));
    });

    it('accepts hostnames, IP literals, domain suffixes, and *.-wildcards', () => {
      assert.doesNotThrow(() => validateNoProxyList('localhost,127.0.0.1'));
      assert.doesNotThrow(() => validateNoProxyList('.example.com,*.local'));
      assert.doesNotThrow(() => validateNoProxyList('::1'));
      assert.doesNotThrow(() => validateNoProxyList('localhost, 127.0.0.1,'));
    });

    it('rejects CIDR patterns (out of scope for v1)', () => {
      const error = captureValidationError(() => validateNoProxyList('10.0.0.0/8'));
      assert.equal(error.field, 'noProxy');
      assert.match(error.reason, /cidr/i);
    });

    it('rejects schemes and invalid wildcard patterns', () => {
      const schemeError = captureValidationError(() => validateNoProxyList('http://localhost'));
      assert.equal(schemeError.field, 'noProxy');

      assert.throws(() => validateNoProxyList('**.example.com'), ValidationError);
      assert.throws(() => validateNoProxyList('example.*.com'), ValidationError);
      assert.throws(() => validateNoProxyList('*..example.com'), ValidationError);
    });

    it('rejects invalid bypass entries', () => {
      assert.throws(() => validateNoProxyList('.'), ValidationError);
      assert.throws(() => validateNoProxyList('user@host'), ValidationError);
      assert.throws(() => validateNoProxyList('example.com:8080'), ValidationError);
      assert.throws(() => validateNoProxyList('local host'), ValidationError);
      assert.throws(() => validateNoProxyList('*.127.0.0.1'), ValidationError);
    });
  });
});
