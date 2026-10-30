import { isDeepStrictEqual } from 'node:util';

import type { HttpSettings } from '../core/proxy-settings-writer';
import { terminalProxyVariables } from '../core/terminal-proxy';
import type { EnvironmentVariableCollection, VscodeApi } from './api';

export const TERMINALS_SETTING = 'proxyToggler.applyToTerminals';

// Gives new integrated terminals and tasks the proxy VS Code uses when the user opts in, and none
// otherwise. VS Code marks the terminals already open for a relaunch.
export function updateTerminalEnvironment(
  vscodeApi: Pick<VscodeApi, 'l10n' | 'workspace'>,
  collection: EnvironmentVariableCollection,
  httpSettings: Pick<HttpSettings, 'read'>
): void {
  const optedIn = vscodeApi.workspace
    .getConfiguration('proxyToggler')
    .get<boolean>('applyToTerminals', false);
  const wanted = optedIn ? terminalProxyVariables(httpSettings.read()) : {};
  const held = Object.fromEntries(
    [...collection].map(([variable, { value }]) => [variable, value])
  );
  // Each change reaches open terminals at once, so an unchanged proxy leaves them alone.
  if (isDeepStrictEqual(held, wanted)) {
    return;
  }

  collection.clear();
  for (const [variable, value] of Object.entries(wanted)) {
    collection.replace(variable, value);
  }
  collection.description = vscodeApi.l10n.t(
    'The proxy VS Code uses, for Git, npm and other command-line tools (Proxy Toggler).'
  );
}
