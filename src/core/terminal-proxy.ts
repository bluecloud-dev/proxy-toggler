import { EXTENSIONS_ALWAYS_DIRECT } from './bypass';
import { withoutCredentials } from './from-settings';
import { parseNoProxyList } from './no-proxy';
import type { HttpSettingKey } from './proxy-settings-writer';
import { problemWith, validateBypassPattern } from './validation';

// The environment variables that give command-line tools, Git among them, the proxy VS Code's
// settings name; none when they name no proxy.
export function terminalProxyVariables(
  settings: Record<HttpSettingKey, unknown>
): Record<string, string> {
  if (typeof settings.proxy !== 'string' || !URL.canParse(settings.proxy.trim())) {
    return {};
  }

  // Secrets never leave VS Code's login dialog (ADR 0003).
  const proxy = withoutCredentials(new URL(settings.proxy.trim()));
  // Terminals go direct where extensions do. Tools read ".x" as x and its subdomains; "*.x" they
  // do not understand. Only entries a profile could hold pass, so a hand-edited value cannot
  // leak credentials, even split at its commas.
  const bypass = [
    ...new Set([
      ...EXTENSIONS_ALWAYS_DIRECT,
      ...parseNoProxyList(settings.noProxy)
        .filter((pattern) => problemWith(() => validateBypassPattern(pattern)) === undefined)
        .map((pattern) => pattern.replace(/^\*\./, '.'))
    ])
  ].join(',');
  // curl, and so Git, reads only the lowercase http_proxy; other tools read the uppercase names
  // first. http.proxyStrictSSL has no counterpart: certificate checks stay on for every tool.
  return {
    http_proxy: proxy,
    https_proxy: proxy,
    no_proxy: bypass,
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    NO_PROXY: bypass
  };
}
