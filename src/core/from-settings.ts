import { defaultPortOf } from './match';
import { parseNoProxyList } from './no-proxy';
import type { HttpSettingKey } from './proxy-settings-writer';
import { problemWith, validateBypassPattern, validateProxyUrl } from './validation';

// What setup starts from when VS Code already uses a proxy: the values a profile can hold, and
// `unheld`, the values it cannot, named for the user without any credentials.
export type ValuesFromSettings = {
  proxyUrl?: string;
  strictSSL: boolean;
  bypassList: string[];
  unheld: string[];
};

export function valuesFromSettings(settings: Record<HttpSettingKey, unknown>): ValuesFromSettings {
  const unheld: string[] = [];

  let proxyUrl: string | undefined;
  if (typeof settings.proxy === 'string' && settings.proxy.trim().length > 0) {
    const read = readProxyUrl(settings.proxy);
    if ('proxyUrl' in read) {
      proxyUrl = read.proxyUrl;
    } else {
      unheld.push(read.unheld);
    }
  }

  const bypassList: string[] = [];
  for (const pattern of parseNoProxyList(settings.noProxy)) {
    if (problemWith(() => validateBypassPattern(pattern)) === undefined) {
      bypassList.push(pattern);
    } else {
      unheld.push(`bypass pattern "${pattern}"`);
    }
  }

  return {
    proxyUrl,
    // VS Code verifies certificates unless told otherwise.
    strictSSL: settings.proxyStrictSSL !== false,
    bypassList,
    unheld
  };
}

// The proxy URL a profile holds for a setting value: no credentials and no trailing slash, with
// the default port written out. A value with a path, or with a scheme a profile cannot use, is
// named instead, and one that does not parse is not repeated, since it may hold credentials.
function readProxyUrl(value: string): { proxyUrl: string } | { unheld: string } {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { unheld: 'the proxy URL' };
  }

  const port = url.port || defaultPortOf(url.protocol);
  const proxyUrl = `${url.protocol}//${url.hostname}:${port ?? ''}`;
  const hasPath = !['', '/'].includes(url.pathname) || url.search !== '' || url.hash !== '';
  if (!port || hasPath || problemWith(() => validateProxyUrl(proxyUrl)) !== undefined) {
    return { unheld: `proxy URL "${withoutCredentials(url)}"` };
  }
  return { proxyUrl };
}

export function withoutCredentials(url: URL): string {
  const copy = new URL(url.href);
  copy.username = '';
  copy.password = '';
  return copy.pathname === '/' && !copy.search && !copy.hash
    ? copy.href.replace(/\/$/, '')
    : copy.href;
}
