import type { KeychainService } from '../core/keychain-service';
import type { Memento } from '../core/proxy-manager';
import type { Notifier } from '../vscode/notification-service';

// Per VS Code Profile, like the secrets: set when a removal found one, cleared once announced.
const NOTICE_PENDING_KEY = 'proxyToggler.credentialsNoticePending';

const NOTICE =
  'Proxy Toggler removed the proxy username and password that version 0.1 saved but never used. When your proxy asks for a sign-in, VS Code shows its own login dialog.';

// A failed removal leaves the secrets for the next activation to retry.
export async function removeStoredCredentials(
  keychainService: Pick<KeychainService, 'removeStoredCredentials'>,
  globalState: Memento
): Promise<void> {
  if (await keychainService.removeStoredCredentials()) {
    await globalState.update(NOTICE_PENDING_KEY, true);
  }
}

export async function announceRemovedCredentials(
  globalState: Memento,
  notificationService: Pick<Notifier, 'showSuccess'>
): Promise<void> {
  if (!globalState.get<boolean>(NOTICE_PENDING_KEY)) {
    return;
  }

  // Cleared before showing, because the notice settles only when the user dismisses it.
  await globalState.update(NOTICE_PENDING_KEY, undefined);
  await notificationService.showSuccess(NOTICE);
}
