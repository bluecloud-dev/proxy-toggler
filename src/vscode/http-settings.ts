import { parseNoProxyList } from '../core/no-proxy';
import type { HttpSettings } from '../core/proxy-manager';
import type { VscodeApi, WorkspaceConfiguration } from './api';

export function createHttpSettings(
  vscodeApi: Pick<VscodeApi, 'ConfigurationTarget' | 'workspace'>
): HttpSettings {
  const httpConfiguration = (): WorkspaceConfiguration =>
    vscodeApi.workspace.getConfiguration('http');

  return {
    read: () => {
      const http = httpConfiguration();
      return {
        proxy: http.get('proxy'),
        proxyStrictSSL: http.get('proxyStrictSSL'),
        noProxy: http.get('noProxy')
      };
    },
    readUserSettings: () => {
      const http = httpConfiguration();
      return {
        proxy: http.inspect('proxy')?.globalValue,
        proxyStrictSSL: http.inspect('proxyStrictSSL')?.globalValue,
        noProxy: http.inspect('noProxy')?.globalValue
      };
    },
    update: async (key, value) => {
      // http.noProxy has been an array setting since VS Code 1.91 introduced it.
      const resolvedValue =
        key === 'noProxy' && typeof value === 'string' ? parseNoProxyList(value) : value;

      await httpConfiguration().update(key, resolvedValue, vscodeApi.ConfigurationTarget.Global);
    }
  };
}
