import { strict as assert } from 'node:assert';

import {
  KeychainError,
  KeychainErrorReason,
  KeychainService
} from '../../src/core/keychain-service';
import { createSecretStorage } from '../support/fakes';

const USERNAME_KEY = 'proxyToggler.credentials.username';
const PASSWORD_KEY = 'proxyToggler.credentials.password';

describe('KeychainService', () => {
  it('removes the credentials 0.1.x stored and reports whether either was there', async () => {
    const secrets = createSecretStorage(
      new Map([
        [USERNAME_KEY, 'alice'],
        [PASSWORD_KEY, 'secret']
      ])
    );
    const service = new KeychainService(secrets);

    const foundFirst = await service.removeStoredCredentials();
    const foundAgain = await service.removeStoredCredentials();

    assert.deepEqual([foundFirst, foundAgain], [true, false]);
    assert.equal(secrets.values.size, 0);
  });

  it('maps keychain errors by operation and reason', async () => {
    const reasons: Array<[Error, 'get' | 'delete', string, KeychainErrorReason]> = [
      [new Error('Keychain is locked'), 'get', 'retrieve', KeychainErrorReason.LOCKED],
      [new Error('Permission denied'), 'delete', 'delete', KeychainErrorReason.PERMISSION_DENIED],
      [new Error('Service not available'), 'get', 'retrieve', KeychainErrorReason.UNAVAILABLE],
      [new Error('Something went wrong'), 'get', 'retrieve', KeychainErrorReason.UNKNOWN]
    ];

    for (const [failure, method, operation, reason] of reasons) {
      const secrets = createSecretStorage(new Map([[USERNAME_KEY, 'alice']]), {
        [method]: failure
      });

      await assert.rejects(
        () => new KeychainService(secrets).removeStoredCredentials(),
        (error: unknown) => {
          assert.ok(error instanceof KeychainError);
          assert.equal(error.operation, operation);
          assert.equal(error.reason, reason);
          assert.equal(error.cause, failure);
          return true;
        },
        failure.message
      );
    }
  });
});
