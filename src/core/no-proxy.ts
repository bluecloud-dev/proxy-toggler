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
