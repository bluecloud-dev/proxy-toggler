import type * as vscode from 'vscode';

import { validateCredentials } from './validation';

const USERNAME_SECRET_KEY = 'proxyToggler.credentials.username';
const PASSWORD_SECRET_KEY = 'proxyToggler.credentials.password';

export type SecretStorage = Pick<vscode.SecretStorage, 'get' | 'store' | 'delete'>;

export const KeychainErrorReason = {
  LOCKED: 'locked',
  PERMISSION_DENIED: 'permission_denied',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown'
} as const;

export type KeychainErrorReason = (typeof KeychainErrorReason)[keyof typeof KeychainErrorReason];

const USER_MESSAGES = {
  locked: 'Your system keychain appears to be locked. Unlock it and try again.',
  permission_denied:
    'Permission denied accessing the system keychain. Check your OS keychain permissions.',
  unavailable: 'The system keychain is unavailable on this machine.',
  unknown: 'Failed to access the system keychain.'
} satisfies Record<KeychainErrorReason, string>;

// SecretStorage errors carry no codes, so the reason is a best-effort guess from the message.
const REASON_HINTS = [
  [KeychainErrorReason.LOCKED, ['locked']],
  [KeychainErrorReason.PERMISSION_DENIED, ['permission', 'denied', 'not authorized']],
  [KeychainErrorReason.UNAVAILABLE, ['unavailable', 'not available']]
] as const;

export class KeychainError extends Error {
  constructor(
    public readonly operation: 'store' | 'retrieve' | 'delete',
    public readonly reason: KeychainErrorReason,
    options?: ErrorOptions
  ) {
    super(`Keychain ${operation} failed: ${reason}`, options);
    this.name = 'KeychainError';
  }

  toUserMessage(): string {
    return USER_MESSAGES[this.reason];
  }
}

export class KeychainService {
  constructor(private readonly secrets: SecretStorage) {}

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
      throw new KeychainError('store', inferKeychainReason(error), { cause: error });
    }
  }

  async clearCredentials(): Promise<void> {
    try {
      await this.secrets.delete(USERNAME_SECRET_KEY);
      await this.secrets.delete(PASSWORD_SECRET_KEY);
    } catch (error: unknown) {
      throw new KeychainError('delete', inferKeychainReason(error), { cause: error });
    }
  }

  async hasCredentials(): Promise<boolean> {
    try {
      const username = normalizeSecretValue(await this.secrets.get(USERNAME_SECRET_KEY));
      const password = normalizeSecretValue(await this.secrets.get(PASSWORD_SECRET_KEY));

      return Boolean(username) && Boolean(password);
    } catch (error: unknown) {
      throw new KeychainError('retrieve', inferKeychainReason(error), { cause: error });
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

  for (const [reason, hints] of REASON_HINTS) {
    if (hints.some((hint) => message.includes(hint))) {
      return reason;
    }
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
