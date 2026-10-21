import type { Memento, ProxyNotices } from '../core/proxy-manager';
import type { Notifier } from '../vscode/notification-service';

// Per VS Code Profile: the notice has been shown.
const SHOWN_KEY = 'proxyToggler.credentialsRemovalNoticeShown';

const NOTICE =
  "Proxy Toggler is replacing http.proxy, which holds a user name and password, so they will be removed. When your proxy asks for a sign-in, VS Code's login dialog asks instead, but extensions' plain http:// requests through a proxy that asks for Basic sign-in will fail.";

// Says once, before the first write that removes them, what happens to credentials in http.proxy.
export function createCredentialsNotice(
  globalState: Memento,
  notificationService: Pick<Notifier, 'showWarning'>
): ProxyNotices {
  return {
    credentialsWillBeRemoved: async () => {
      if (globalState.get<boolean>(SHOWN_KEY)) {
        return;
      }
      await globalState.update(SHOWN_KEY, true);
      // Shown without waiting for the user, so the write goes ahead.
      void notificationService.showWarning(NOTICE);
    }
  };
}
