import { strict as assert } from 'node:assert';

import {
  KeychainError,
  KeychainErrorReason,
  KeychainService
} from '../../src/core/keychain-service';
import { ValidationError } from '../../src/core/validation';

type SecretsStub = {
  get: (key: string) => Promise<string | undefined>;
  store: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

describe('KeychainService', () => {
  it('stores, retrieves, and clears credentials', async () => {
    const secrets = createSecretsStub();
    const service = new KeychainService(secrets);

    assert.equal(await service.hasCredentials(), false);
    assert.equal(await service.retrieveCredentials(), undefined);

    await service.storeCredentials(' alice ', ' secret ');
    assert.equal(await service.hasCredentials(), true);
    assert.deepEqual(await service.retrieveCredentials(), {
      username: 'alice',
      password: 'secret'
    });

    await service.clearCredentials();
    assert.equal(await service.hasCredentials(), false);
    assert.equal(await service.retrieveCredentials(), undefined);
  });

  it('rejects mismatched username/password', async () => {
    const secrets = createSecretsStub();
    const service = new KeychainService(secrets);

    await assert.rejects(() => service.storeCredentials('alice', undefined), ValidationError);
    await assert.rejects(() => service.storeCredentials(undefined, 'secret'), ValidationError);
  });

  it('maps keychain errors by operation and reason', async () => {
    const locked = createSecretsStub({
      storeError: new Error('Keychain is locked')
    });

    const lockedService = new KeychainService(locked);
    await assert.rejects(
      () => lockedService.storeCredentials('alice', 'secret'),
      (error: unknown) => {
        assert.ok(error instanceof KeychainError);
        assert.equal(error.operation, 'store');
        assert.equal(error.reason, KeychainErrorReason.LOCKED);
        assert.match(error.toUserMessage(), /locked/i);
        return true;
      }
    );

    const denied = createSecretsStub({
      deleteError: new Error('Permission denied')
    });

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

    const unavailable = createSecretsStub({
      getError: new Error('Service not available')
    });

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

    const unknown = createSecretsStub({
      getError: new Error('Something went wrong')
    });

    const unknownService = new KeychainService(unknown);
    await assert.rejects(
      () => unknownService.retrieveCredentials(),
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

function createSecretsStub(errors?: {
  getError?: Error;
  storeError?: Error;
  deleteError?: Error;
}): SecretsStub {
  const store = new Map<string, string>();

  return {
    get: async (key: string): Promise<string | undefined> => {
      if (errors?.getError) {
        throw errors.getError;
      }
      return store.get(key);
    },
    store: async (key: string, value: string): Promise<void> => {
      if (errors?.storeError) {
        throw errors.storeError;
      }
      store.set(key, value);
    },
    delete: async (key: string): Promise<void> => {
      if (errors?.deleteError) {
        throw errors.deleteError;
      }
      store.delete(key);
    }
  };
}
