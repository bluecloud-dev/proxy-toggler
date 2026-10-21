import { parseNoProxyList } from './no-proxy';
import type { HttpSettingKey, ProxySettingValues } from './proxy-settings-writer';

const DEFAULT_PORTS: Partial<Record<string, string>> = { 'http:': '80', 'https:': '443' };

// The port a proxy URL of this scheme uses when it names none, such as '80' for 'http:'.
export function defaultPortOf(protocol: string): string | undefined {
  return DEFAULT_PORTS[protocol];
}

// Whether a proxy URL holds a user name or password.
export function hasCredentials(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value.trim());
    return url.username !== '' || url.password !== '';
  } catch {
    return false;
  }
}

// Whether VS Code's proxy settings carry these values; see Match in GLOSSARY.md.
export function settingsMatch(
  settings: Record<HttpSettingKey, unknown>,
  values: ProxySettingValues
): boolean {
  const address = proxyAddress(settings.proxy);
  return (
    address !== undefined &&
    address === proxyAddress(values.proxy) &&
    // VS Code verifies certificates unless told otherwise.
    (settings.proxyStrictSSL ?? true) === values.proxyStrictSSL &&
    sameEntries(bypassPatterns(settings.noProxy), bypassPatterns(values.noProxy))
  );
}

function bypassPatterns(value: unknown): Set<string> {
  return new Set(parseNoProxyList(value).map((pattern) => pattern.toLowerCase()));
}

function sameEntries(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((entry) => right.has(entry));
}

// The parts of a proxy URL that decide where traffic goes: the scheme, host and port, with an
// omitted port as the scheme's default. Undefined for a value that does not parse.
function proxyAddress(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }

  const port = url.port || defaultPortOf(url.protocol) || '';
  return `${url.protocol}//${url.hostname}:${port}`;
}
