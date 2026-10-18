import type * as vscode from 'vscode';

import type { ProxyCredentials } from './proxy-configuration';
import { validateCredentials } from './validation';

const USERNAME_SECRET_KEY = 'proxyToggler.credentials.username';
const PASSWORD_SECRET_KEY = 'proxyToggler.credentials.password';

export type SecretStorage = Pick<vscode.SecretStorage, 'get' | 'store' | 'delete'>;

export enum KeychainErrorReason {
  LOCKED = 'locked',
  PERMISSION_DENIED = 'permission_denied',
  UNAVAILABLE = 'unavailable',
  UNKNOWN = 'unknown'
}

export class KeychainError extends Error {
  constructor(
    public readonly operation: 'store' | 'retrieve' | 'delete',
    public readonly reason: KeychainErrorReason,
    public override readonly cause?: Error
  ) {
    super(`Keychain ${operation} failed: ${reason}`);
    this.name = 'KeychainError';
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toUserMessage(): string {
    if (this.reason === KeychainErrorReason.LOCKED) {
      return 'Your system keychain appears to be locked. Unlock it and try again.';
    }

    if (this.reason === KeychainErrorReason.PERMISSION_DENIED) {
      return 'Permission denied accessing the system keychain. Check your OS keychain permissions.';
    }

    if (this.reason === KeychainErrorReason.UNAVAILABLE) {
      return 'The system keychain is unavailable on this machine.';
    }

    return 'Failed to access the system keychain.';
  }
}

export class KeychainService {
  constructor(private readonly secrets: SecretStorage) {}

  dispose(): void {
    // No-op: SecretStorage is owned by VS Code.
  }

  async storeCredentials(username?: string, password?: string): Promise<void> {
    const normalizedUsername = normalizeSecretValue(username);
    const normalizedPassword = normalizeSecretValue(password);

    validateCredentials(normalizedUsername, normalizedPassword);

    // Blank credentials mean "no authentication", so clear rather than store empty secrets.
    if (!normalizedUsername || !normalizedPassword) {
      await this.clearCredentials();
      return;
    }

    try {
      await this.secrets.store(USERNAME_SECRET_KEY, normalizedUsername);
      await this.secrets.store(PASSWORD_SECRET_KEY, normalizedPassword);
    } catch (error: unknown) {
      throw new KeychainError('store', inferKeychainReason(error), asError(error));
    }
  }

  async retrieveCredentials(): Promise<ProxyCredentials | undefined> {
    try {
      const username = normalizeSecretValue(await this.secrets.get(USERNAME_SECRET_KEY));
      const password = normalizeSecretValue(await this.secrets.get(PASSWORD_SECRET_KEY));

      if (!username || !password) {
        return undefined;
      }

      return { username, password };
    } catch (error: unknown) {
      throw new KeychainError('retrieve', inferKeychainReason(error), asError(error));
    }
  }

  async clearCredentials(): Promise<void> {
    try {
      await this.secrets.delete(USERNAME_SECRET_KEY);
      await this.secrets.delete(PASSWORD_SECRET_KEY);
    } catch (error: unknown) {
      throw new KeychainError('delete', inferKeychainReason(error), asError(error));
    }
  }

  async hasCredentials(): Promise<boolean> {
    try {
      const username = normalizeSecretValue(await this.secrets.get(USERNAME_SECRET_KEY));
      const password = normalizeSecretValue(await this.secrets.get(PASSWORD_SECRET_KEY));

      return Boolean(username) && Boolean(password);
    } catch (error: unknown) {
      throw new KeychainError('retrieve', inferKeychainReason(error), asError(error));
    }
  }
}

function normalizeSecretValue(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// SecretStorage errors carry no codes, so the reason is a best-effort guess from the message.
function inferKeychainReason(error: unknown): KeychainErrorReason {
  const message = extractErrorMessage(error).toLowerCase();

  if (message.includes('locked')) {
    return KeychainErrorReason.LOCKED;
  }

  if (
    message.includes('permission') ||
    message.includes('denied') ||
    message.includes('not authorized')
  ) {
    return KeychainErrorReason.PERMISSION_DENIED;
  }

  if (message.includes('unavailable') || message.includes('not available')) {
    return KeychainErrorReason.UNAVAILABLE;
  }

  return KeychainErrorReason.UNKNOWN;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'unknown error';
}

function asError(error: unknown): Error | undefined {
  return error instanceof Error ? error : undefined;
}
