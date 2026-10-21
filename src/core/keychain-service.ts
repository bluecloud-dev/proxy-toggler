import type * as vscode from 'vscode';

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

// Proxy Toggler stores no secrets (ADR 0003); this only removes the ones 0.1.x stored.
export class KeychainService {
  constructor(private readonly secrets: SecretStorage) {}

  private async clearCredentials(): Promise<void> {
    try {
      await this.secrets.delete(USERNAME_SECRET_KEY);
      await this.secrets.delete(PASSWORD_SECRET_KEY);
    } catch (error: unknown) {
      throw new KeychainError('delete', inferKeychainReason(error), { cause: error });
    }
  }

  // 0.1.x stored a username and password that no version applied, and profiles hold no
  // credentials (ADR 0003). Deletes both and reports whether either was there.
  async removeStoredCredentials(): Promise<boolean> {
    let found: boolean;
    try {
      found =
        (await this.secrets.get(USERNAME_SECRET_KEY)) !== undefined ||
        (await this.secrets.get(PASSWORD_SECRET_KEY)) !== undefined;
    } catch (error: unknown) {
      throw new KeychainError('retrieve', inferKeychainReason(error), { cause: error });
    }

    if (found) {
      await this.clearCredentials();
    }
    return found;
  }
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
