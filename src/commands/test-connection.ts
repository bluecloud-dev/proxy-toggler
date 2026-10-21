import { extensionsSendDirect, windowSendsDirect } from '../core/bypass';
import type { Profile } from '../core/profiles';
import { testConnection, type TestOptions } from '../core/test-connection';
import type { VscodeApi } from '../vscode/api';
import type { Notifier } from '../vscode/notification-service';
import { proxySide } from '../vscode/proxy-side';
import { askText } from '../vscode/quick-input';

type TestApi = Pick<
  VscodeApi,
  'ProgressLocation' | 'QuickInputButtons' | 'env' | 'l10n' | 'window' | 'workspace'
>;

const DEFAULT_TARGET = 'https://marketplace.visualstudio.com';

// An optional, advisory check of a profile's proxy. The URL is stored nowhere, and the result is
// shown once and never logged.
export async function testConnectionCommand(
  vscodeApi: TestApi,
  notificationService: Notifier,
  profile: Profile,
  options: TestOptions = {}
): Promise<void> {
  const { l10n } = vscodeApi;
  if (!/^https?:/i.test(profile.proxyUrl)) {
    void notificationService.showSuccess(
      `${profile.name}: Test Connection covers only HTTP and HTTPS proxies, so it did not test this SOCKS proxy.`
    );
    return;
  }

  const target = await askText(vscodeApi, {
    title: l10n.t('Test Connection for {0}', profile.name),
    prompt: l10n.t('A URL to reach through the proxy. It is not saved.'),
    value: DEFAULT_TARGET,
    canGoBack: false,
    validate: (value) =>
      /^https?:\/\/[^/]/i.test(value.trim()) && URL.canParse(value.trim())
        ? undefined
        : l10n.t('Enter an http:// or https:// URL.')
  });
  if (typeof target !== 'string') {
    return;
  }

  const host = new URL(target.trim()).hostname;
  const proxySupportOff =
    vscodeApi.workspace.getConfiguration('http').get<string>('proxySupport') === 'off';
  // The test runs where the extension host does: on the remote side of a remote window. The
  // VS Code window always uses this computer's settings, so a remote machine's own settings
  // apply to extensions alone.
  const side = proxySide(vscodeApi);
  const windowUsesProfile = side.kind === 'local';
  const windowDirect = windowSendsDirect(host, profile.bypassList);
  const extensionsDirect = proxySupportOff || extensionsSendDirect(host, profile.bypassList);
  if (extensionsDirect && (windowDirect || !windowUsesProfile)) {
    void notificationService.showSuccess(
      windowUsesProfile
        ? `${profile.name}: Both VS Code's window and extensions reach ${host} directly, so there is nothing to test through this proxy.`
        : `${profile.name}: Extensions reach ${host} directly, so there is nothing to test through this proxy.`
    );
    return;
  }

  const verdict = await vscodeApi.window.withProgress(
    {
      location: vscodeApi.ProgressLocation.Notification,
      title: l10n.t('Testing {0}…', profile.name)
    },
    () => testConnection(profile.proxyUrl, target.trim(), options)
  );

  const notes = [
    windowUsesProfile && windowDirect
      ? `VS Code's window reaches ${host} directly, so only extensions use this proxy for it.`
      : '',
    !windowDirect && extensionsDirect && !proxySupportOff
      ? `Extensions reach ${host} directly, so only VS Code's window uses this proxy for it.`
      : '',
    proxySupportOff
      ? 'http.proxySupport is "off", so extensions ignore VS Code\'s proxy settings.'
      : '',
    side.remote === undefined ? '' : `Tested from ${side.remote}.`,
    side.kind === 'local' && side.remote !== undefined
      ? "VS Code's window connects from this computer and was not tested."
      : ''
  ].filter((note) => note.length > 0);
  const message = [`${profile.name}: ${verdict.message}`, ...notes].join(' ');

  // Shown without waiting for the user to dismiss it.
  if (verdict.outcome === 'fail') {
    void notificationService.showError(message);
  } else if (verdict.outcome === 'warn') {
    void notificationService.showWarning(message);
  } else {
    void notificationService.showSuccess(message);
  }
}
