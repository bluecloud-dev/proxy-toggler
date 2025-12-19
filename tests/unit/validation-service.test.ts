import { strict as assert } from 'node:assert';

import { ValidationError, ValidationService } from '../../src/services/validation-service';

function captureValidationError(operation: () => void): ValidationError {
  try {
    operation();
  } catch (error: unknown) {
    assert.ok(error instanceof ValidationError);
    return error;
  }

  assert.fail('Expected ValidationError to be thrown');
}

describe('ValidationService', () => {
  describe('validateProxyUrl', () => {
    it('accepts valid http/https URLs with ports', () => {
      assert.doesNotThrow(() => ValidationService.validateProxyUrl('http://proxy.example.com:8080'));
      assert.doesNotThrow(() => ValidationService.validateProxyUrl('https://10.0.0.1:3128'));
      assert.doesNotThrow(() => ValidationService.validateProxyUrl('http://[::1]:8080'));
      assert.doesNotThrow(() => ValidationService.validateProxyUrl('HTTP://proxy.example.com:8080'));
    });

    it('rejects missing or malformed URLs', () => {
      const emptyError = captureValidationError(() => ValidationService.validateProxyUrl(''));
      assert.equal(emptyError.field, 'proxyUrl');

      const whitespaceError = captureValidationError(() => ValidationService.validateProxyUrl('   '));
      assert.equal(whitespaceError.field, 'proxyUrl');

      const notStringError = captureValidationError(() =>
        ValidationService.validateProxyUrl(null as unknown as string)
      );
      assert.equal(notStringError.field, 'proxyUrl');

      const noSchemeError = captureValidationError(() =>
        ValidationService.validateProxyUrl('proxy.example.com:8080')
      );
      assert.equal(noSchemeError.field, 'proxyUrl');
      assert.match(noSchemeError.reason, /scheme/i);
    });

    it('rejects unsupported schemes', () => {
      const error = captureValidationError(() =>
        ValidationService.validateProxyUrl('ftp://proxy.example.com:8080')
      );

      assert.equal(error.field, 'proxyUrl');
      assert.match(error.reason, /scheme/i);
    });

    it('rejects missing port numbers and invalid port ranges', () => {
      const missingPortError = captureValidationError(() =>
        ValidationService.validateProxyUrl('http://proxy.example.com')
      );
      assert.equal(missingPortError.field, 'proxyUrl');
      assert.match(missingPortError.reason, /port/i);

      const zeroPortError = captureValidationError(() =>
        ValidationService.validateProxyUrl('http://proxy.example.com:0')
      );
      assert.equal(zeroPortError.field, 'proxyUrl');

      const tooHighPortError = captureValidationError(() =>
        ValidationService.validateProxyUrl('http://proxy.example.com:65536')
      );
      assert.equal(tooHighPortError.field, 'proxyUrl');
    });

    it('rejects credentials embedded in the URL', () => {
      const error = captureValidationError(() =>
        ValidationService.validateProxyUrl('http://user:pass@proxy.example.com:8080')
      );
      assert.equal(error.field, 'proxyUrl');
      assert.match(error.reason, /credentials/i);
    });

    it('rejects paths, queries, and fragments', () => {
      const trailingSlashError = captureValidationError(() =>
        ValidationService.validateProxyUrl('http://proxy.example.com:8080/')
      );
      assert.equal(trailingSlashError.field, 'proxyUrl');

      const pathError = captureValidationError(() =>
        ValidationService.validateProxyUrl('http://proxy.example.com:8080/path')
      );
      assert.equal(pathError.field, 'proxyUrl');

      const queryError = captureValidationError(() =>
        ValidationService.validateProxyUrl('http://proxy.example.com:8080?foo=bar')
      );
      assert.equal(queryError.field, 'proxyUrl');

      const fragmentError = captureValidationError(() =>
        ValidationService.validateProxyUrl('http://proxy.example.com:8080#frag')
      );
      assert.equal(fragmentError.field, 'proxyUrl');
    });
  });

  describe('validateCredentials', () => {
    it('accepts both omitted and both provided', () => {
      assert.doesNotThrow(() => ValidationService.validateCredentials(undefined, undefined));
      assert.doesNotThrow(() => ValidationService.validateCredentials('alice', 'secret'));
      assert.doesNotThrow(() => ValidationService.validateCredentials('', ''));
      assert.doesNotThrow(() => ValidationService.validateCredentials('   ', '   '));
    });

    it('rejects mismatched username/password pairing', () => {
      const usernameOnlyError = captureValidationError(() =>
        ValidationService.validateCredentials('alice', undefined)
      );
      assert.equal(usernameOnlyError.field, 'credentials');

      const passwordOnlyError = captureValidationError(() =>
        ValidationService.validateCredentials(undefined, 'secret')
      );
      assert.equal(passwordOnlyError.field, 'credentials');

      assert.throws(() => ValidationService.validateCredentials('alice', ''), ValidationError);
      assert.throws(() => ValidationService.validateCredentials('', 'secret'), ValidationError);
    });
  });

  describe('validateNoProxyPattern', () => {
    it('accepts empty or undefined patterns', () => {
      assert.doesNotThrow(() => ValidationService.validateNoProxyPattern());
      assert.doesNotThrow(() => ValidationService.validateNoProxyPattern(''));
      assert.doesNotThrow(() => ValidationService.validateNoProxyPattern('   '));
    });

    it('accepts hostnames, IP literals, domain suffixes, and *.-wildcards', () => {
      assert.doesNotThrow(() => ValidationService.validateNoProxyPattern('localhost,127.0.0.1'));
      assert.doesNotThrow(() => ValidationService.validateNoProxyPattern('.example.com,*.local'));
      assert.doesNotThrow(() => ValidationService.validateNoProxyPattern('::1'));
      assert.doesNotThrow(() => ValidationService.validateNoProxyPattern('localhost, 127.0.0.1,'));
    });

    it('rejects CIDR patterns (out of scope for v1)', () => {
      const error = captureValidationError(() => ValidationService.validateNoProxyPattern('10.0.0.0/8'));
      assert.equal(error.field, 'noProxy');
      assert.match(error.reason, /cidr/i);
    });

    it('rejects schemes and invalid wildcard patterns', () => {
      const schemeError = captureValidationError(() =>
        ValidationService.validateNoProxyPattern('http://localhost')
      );
      assert.equal(schemeError.field, 'noProxy');

      assert.throws(() => ValidationService.validateNoProxyPattern('**.example.com'), ValidationError);
      assert.throws(() => ValidationService.validateNoProxyPattern('example.*.com'), ValidationError);
      assert.throws(() => ValidationService.validateNoProxyPattern('*..example.com'), ValidationError);
    });

    it('rejects invalid bypass entries', () => {
      assert.throws(() => ValidationService.validateNoProxyPattern('.'), ValidationError);
      assert.throws(() => ValidationService.validateNoProxyPattern('user@host'), ValidationError);
      assert.throws(() => ValidationService.validateNoProxyPattern('example.com:8080'), ValidationError);
      assert.throws(() => ValidationService.validateNoProxyPattern('local host'), ValidationError);
      assert.throws(() => ValidationService.validateNoProxyPattern('*.127.0.0.1'), ValidationError);
    });
  });

  describe('validatePort', () => {
    it('rejects non-integers and out-of-range ports', () => {
      assert.throws(() => ValidationService.validatePort(Number.NaN), ValidationError);
      assert.throws(() => ValidationService.validatePort(0), ValidationError);
      assert.throws(() => ValidationService.validatePort(65536), ValidationError);
      assert.doesNotThrow(() => ValidationService.validatePort(8080));
    });
  });

  describe('validateScheme', () => {
    it('rejects unsupported schemes', () => {
      assert.throws(() => ValidationService.validateScheme('ftp:'), ValidationError);
      assert.doesNotThrow(() => ValidationService.validateScheme('http:'));
      assert.doesNotThrow(() => ValidationService.validateScheme('https:'));
    });
  });
});
