export const DEFAULT_NO_PROXY = 'localhost,127.0.0.1';

// A blank bypass list falls back to the default, so local addresses keep bypassing the proxy.
export function withDefaultNoProxy(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_NO_PROXY;
}

// The extension stores the bypass list as one comma-separated string; VS Code's http.noProxy
// setting is an array. Both shapes parse to the same trimmed, non-empty entries.
export function parseNoProxyList(value: unknown): string[] {
  return rawEntries(value)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function rawEntries(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  if (typeof value === 'string') {
    return value.split(',');
  }

  return [];
}
