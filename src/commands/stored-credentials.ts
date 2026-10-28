import type { Memento } from '../core/proxy-manager';
import type { SecretStorage } from '../vscode/api';
import type { Notifier } from '../vscode/notification-service';

// The proxy username and password 0.1.x stored and no version applied; profiles hold no
// credentials (ADR 0003).
const SECRET_KEYS = ['proxyToggler.credentials.username', 'proxyToggler.credentials.password'];

// Per VS Code Profile, like the secrets: set when a removal found one, cleared once announced.
const NOTICE_PENDING_KEY = 'proxyToggler.credentialsNoticePending';

const NOTICE =
  'Proxy Toggler removed the proxy username and password that version 0.1 saved but never used. When your proxy asks for a sign-in, VS Code shows its own login dialog.';

// A failed removal leaves the secrets for the next activation to retry.
export async function removeStoredCredentials(
  secrets: SecretStorage,
  globalState: Memento
): Promise<void> {
  const values = await Promise.all(SECRET_KEYS.map((key) => secrets.get(key)));
  if (values.every((value) => value === undefined)) {
    return;
  }

  for (const key of SECRET_KEYS) {
    await secrets.delete(key);
  }
  await globalState.update(NOTICE_PENDING_KEY, true);
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
