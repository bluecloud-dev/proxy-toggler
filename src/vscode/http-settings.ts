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
    update: async (key, value) => {
      const http = httpConfiguration();
      const resolvedValue =
        key === 'noProxy' && typeof value === 'string' && isArraySetting(http, key)
          ? parseNoProxyList(value)
          : value;

      await http.update(key, resolvedValue, vscodeApi.ConfigurationTarget.Global);
    }
  };
}

function isArraySetting(configuration: WorkspaceConfiguration, key: string): boolean {
  return Array.isArray(configuration.inspect(key)?.defaultValue);
}
