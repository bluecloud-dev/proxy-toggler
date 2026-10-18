import type * as vscode from 'vscode';

import type { ProxyCredentials } from '../types/proxy-configuration';
import { ValidationService } from './validation-service';

const USERNAME_SECRET_KEY = 'proxyToggler.credentials.username';
const PASSWORD_SECRET_KEY = 'proxyToggler.credentials.password';

/**
 * Minimal SecretStorage surface used by this extension.
 */
export type SecretStorage = Pick<vscode.SecretStorage, 'get' | 'store' | 'delete'>;

/**
 * Best-effort classification for SecretStorage failures.
 */
export enum KeychainErrorReason {
  LOCKED = 'locked',
  PERMISSION_DENIED = 'permission_denied',
  UNAVAILABLE = 'unavailable',
  UNKNOWN = 'unknown'
}

export class KeychainError extends Error {
  /**
   * @param operation The SecretStorage operation that failed.
   * @param reason A best-effort classification for the failure.
   * @param cause The original error, if available.
   * @example
   * ```ts
   * throw new KeychainError('store', KeychainErrorReason.LOCKED, error);
   * ```
   */
  constructor(
    public readonly operation: 'store' | 'retrieve' | 'delete',
    public readonly reason: KeychainErrorReason,
    public override readonly cause?: Error
  ) {
    super(`Keychain ${operation} failed: ${reason}`);
    this.name = 'KeychainError';
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Returns a user-friendly message for showing in the VS Code UI.
   *
   * @returns A non-sensitive error message safe for display.
   * @example
   * ```ts
   * await notificationService.showError(error.toUserMessage());
   * ```
   */
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
  /**
   * @param secrets VS Code SecretStorage (OS keychain).
   * @example
   * ```ts
   * const service = new KeychainService(context.secrets);
   * ```
   */
  constructor(private readonly secrets: SecretStorage) {}

  /**
   * @returns void
   * @example
   * ```ts
   * service.dispose();
   * ```
   */
  dispose(): void {
    // No-op: SecretStorage is owned by VS Code.
  }

  /**
   * Stores proxy credentials in SecretStorage.
   *
   * If either value is missing/blank, credentials are cleared instead.
   *
   * @param username Proxy username.
   * @param password Proxy password.
   * @returns void
   * @throws {ValidationError} If only one of username/password is provided.
   * @throws {KeychainError} If SecretStorage is locked, unavailable, or denied.
   * @example
   * ```ts
   * await service.storeCredentials('alice', 'secret');
   * ```
   */
  async storeCredentials(username?: string, password?: string): Promise<void> {
    const normalizedUsername = normalizeSecretValue(username);
    const normalizedPassword = normalizeSecretValue(password);

    ValidationService.validateCredentials(normalizedUsername, normalizedPassword);

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

  /**
   * Retrieves proxy credentials from SecretStorage.
   *
   * @returns Credentials when both username and password exist; otherwise `undefined`.
   * @throws {KeychainError} If SecretStorage access fails.
   * @example
   * ```ts
   * const credentials = await service.retrieveCredentials();
   * ```
   */
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

  /**
   * Clears stored proxy credentials from SecretStorage.
   *
   * @returns void
   * @throws {KeychainError} If SecretStorage access fails.
   * @example
   * ```ts
   * await service.clearCredentials();
   * ```
   */
  async clearCredentials(): Promise<void> {
    try {
      await this.secrets.delete(USERNAME_SECRET_KEY);
      await this.secrets.delete(PASSWORD_SECRET_KEY);
    } catch (error: unknown) {
      throw new KeychainError('delete', inferKeychainReason(error), asError(error));
    }
  }

  /**
   * @returns True if both username and password are present in SecretStorage.
   * @throws {KeychainError} If SecretStorage access fails.
   * @example
   * ```ts
   * const hasCreds = await service.hasCredentials();
   * ```
   */
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
