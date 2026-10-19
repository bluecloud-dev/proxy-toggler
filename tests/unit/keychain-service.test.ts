import { strict as assert } from 'node:assert';

import {
  KeychainError,
  KeychainErrorReason,
  KeychainService
} from '../../src/core/keychain-service';
import { ValidationError } from '../../src/core/validation';
import { createSecretStorage } from '../support/fakes';

describe('KeychainService', () => {
  it('stores trimmed credentials under stable keys and clears them', async () => {
    const secrets = createSecretStorage();
    const service = new KeychainService(secrets);
    assert.equal(await service.hasCredentials(), false);

    await service.storeCredentials(' alice ', ' secret ');

    assert.equal(await service.hasCredentials(), true);
    assert.deepEqual(Object.fromEntries(secrets.values), {
      'proxyToggler.credentials.username': 'alice',
      'proxyToggler.credentials.password': 'secret'
    });

    await service.clearCredentials();

    assert.equal(await service.hasCredentials(), false);
    assert.equal(secrets.values.size, 0);
  });

  it('rejects mismatched username/password', async () => {
    const secrets = createSecretStorage();
    const service = new KeychainService(secrets);

    await assert.rejects(() => service.storeCredentials('alice', undefined), ValidationError);
    await assert.rejects(() => service.storeCredentials(undefined, 'secret'), ValidationError);
  });

  it('maps keychain errors by operation and reason', async () => {
    const locked = createSecretStorage(new Map(), { store: new Error('Keychain is locked') });

    const lockedService = new KeychainService(locked);
    await assert.rejects(
      () => lockedService.storeCredentials('alice', 'secret'),
      (error: unknown) => {
        assert.ok(error instanceof KeychainError);
        assert.equal(error.operation, 'store');
        assert.equal(error.reason, KeychainErrorReason.LOCKED);
        assert.match(String(error.cause), /Keychain is locked/);
        assert.match(error.toUserMessage(), /locked/i);
        return true;
      }
    );

    const denied = createSecretStorage(new Map(), { delete: new Error('Permission denied') });

    const deniedService = new KeychainService(denied);
    await deniedService.storeCredentials('alice', 'secret');

    await assert.rejects(
      () => deniedService.clearCredentials(),
      (error: unknown) => {
        assert.ok(error instanceof KeychainError);
        assert.equal(error.operation, 'delete');
        assert.equal(error.reason, KeychainErrorReason.PERMISSION_DENIED);
        assert.match(error.toUserMessage(), /permission/i);
        return true;
      }
    );

    const unavailable = createSecretStorage(new Map(), { get: new Error('Service not available') });

    const unavailableService = new KeychainService(unavailable);
    await assert.rejects(
      () => unavailableService.hasCredentials(),
      (error: unknown) => {
        assert.ok(error instanceof KeychainError);
        assert.equal(error.operation, 'retrieve');
        assert.equal(error.reason, KeychainErrorReason.UNAVAILABLE);
        assert.match(error.toUserMessage(), /unavailable/i);
        return true;
      }
    );

    const unknown = createSecretStorage(new Map(), { get: new Error('Something went wrong') });

    const unknownService = new KeychainService(unknown);
    await assert.rejects(
      () => unknownService.hasCredentials(),
      (error: unknown) => {
        assert.ok(error instanceof KeychainError);
        assert.equal(error.operation, 'retrieve');
        assert.equal(error.reason, KeychainErrorReason.UNKNOWN);
        assert.match(error.toUserMessage(), /failed/i);
        return true;
      }
    );
  });
});
