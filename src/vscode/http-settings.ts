import { parseNoProxyList } from '../core/no-proxy';
import type { HttpSettingKey, HttpSettings } from '../core/proxy-settings-writer';
import type { VscodeApi, WorkspaceConfiguration } from './api';
import { proxySide } from './proxy-side';

// inspect() also returns the user value from each side, which vscode.d.ts omits.
type SidedInspection = {
  defaultValue?: unknown;
  globalValue?: unknown;
  globalRemoteValue?: unknown;
};

export function createHttpSettings(
  vscodeApi: Pick<VscodeApi, 'ConfigurationTarget' | 'env' | 'workspace'>
): HttpSettings {
  const httpConfiguration = (): WorkspaceConfiguration =>
    vscodeApi.workspace.getConfiguration('http');

  // The value in the settings this window manages, undefined where there is none. A remote
  // machine's own settings count alone: at start-up, VS Code can hand the remote side this
  // computer's proxy while the remote machine's settings hold none (TESTING.md, "Remote windows",
  // result 1). VS Code 1.97.0 and later report that value as globalRemoteValue; without it, the
  // value in effect is the best there is.
  const userValue = (http: WorkspaceConfiguration, key: HttpSettingKey): unknown => {
    const inspection = http.inspect(key) as SidedInspection | undefined;
    if (proxySide(vscodeApi).kind === 'remote' && inspection && 'globalRemoteValue' in inspection) {
      return inspection.globalRemoteValue;
    }
    return inspection?.globalValue;
  };

  const read = (key: HttpSettingKey): unknown => {
    const http = httpConfiguration();
    if (proxySide(vscodeApi).kind !== 'remote') {
      return http.get(key);
    }
    return userValue(http, key) ?? (http.inspect(key) as SidedInspection | undefined)?.defaultValue;
  };

  return {
    read: () => ({
      proxy: read('proxy'),
      proxyStrictSSL: read('proxyStrictSSL'),
      noProxy: read('noProxy')
    }),
    readUserSettings: () => {
      const http = httpConfiguration();
      return {
        proxy: userValue(http, 'proxy'),
        proxyStrictSSL: userValue(http, 'proxyStrictSSL'),
        noProxy: userValue(http, 'noProxy')
      };
    },
    update: async (key, value) => {
      // http.noProxy has been an array setting since VS Code 1.91 introduced it.
      let resolvedValue =
        key === 'noProxy' && typeof value === 'string' ? parseNoProxyList(value) : value;
      // A remote machine's own settings keep an empty http.proxy rather than none, so that this
      // computer's proxy cannot take its place at start-up (TESTING.md, "Remote windows", result 6).
      if (
        key === 'proxy' &&
        resolvedValue === undefined &&
        proxySide(vscodeApi).kind === 'remote'
      ) {
        resolvedValue = '';
      }

      await httpConfiguration().update(key, resolvedValue, vscodeApi.ConfigurationTarget.Global);
    }
  };
}

type SideSwitchApi = Pick<VscodeApi, 'ConfigurationTarget' | 'workspace'>;

// Gives the remote side of this window its own proxy settings, which applies without a reload
// (TESTING.md, "Remote windows", check 3), and pins them with an empty http.proxy at once. VS Code
// makes http.* the remote machine's before the first write resolves, so the second lands there
// (check 8).
export async function useOwnProxySettings(vscodeApi: SideSwitchApi): Promise<void> {
  const http = vscodeApi.workspace.getConfiguration('http');
  const target = vscodeApi.ConfigurationTarget.Global;
  await http.update('useLocalProxyConfiguration', false, target);
  await http.update('proxy', '', target);
}

// Hands the remote side back to this computer's proxy settings. The remote machine's http.*
// values go first, while they still belong to it: once the remote side uses this computer's
// settings, a write of a key that the remote file still holds lands there and changes nothing
// (check 2). Removing the setting applies without a reload too (check 7).
export async function useLocalProxySettings(vscodeApi: SideSwitchApi): Promise<void> {
  const http = vscodeApi.workspace.getConfiguration('http');
  const target = vscodeApi.ConfigurationTarget.Global;
  for (const key of ['proxy', 'proxyStrictSSL', 'noProxy']) {
    await http.update(key, undefined, target);
  }
  await http.update('useLocalProxyConfiguration', undefined, target);
}
