import { isIP } from 'node:net';

// The window and extensions read http.noProxy differently; see the v0.2.0 research, finding B1.

// Extensions go through @vscode/proxy-agent: each pattern is a domain suffix, so "x" and ".x"
// both cover the domain and every subdomain; "*.x" never matches; a lone "*" matches everything.
const EXTENSIONS_ALWAYS_DIRECT = ['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1'];

export function extensionsSendDirect(host: string, patterns: readonly string[]): boolean {
  const name = normalize(host);
  if (EXTENSIONS_ALWAYS_DIRECT.includes(name)) {
    return true;
  }

  return patterns.some((pattern) => {
    const rule = pattern.trim().toLowerCase();
    if (rule === '*') {
      return true;
    }
    if (rule.startsWith('*')) {
      return false;
    }
    const domain = rule.startsWith('.') ? rule.slice(1) : rule;
    return name === domain || name.endsWith(`.${domain}`);
  });
}

// The window passes the patterns to Chromium with "<local>" appended: globs apply, a leading "."
// means "*.", dotless hosts go direct, and so do localhost, *.localhost, 127.0.0.0/8, ::1 and
// link-local addresses.
export function windowSendsDirect(host: string, patterns: readonly string[]): boolean {
  const name = normalize(host);
  if (isImplicitlyDirect(name) || (!name.includes('.') && isIP(name) === 0)) {
    return true;
  }

  return patterns.some((pattern) => {
    const rule = pattern.trim().toLowerCase();
    const glob = rule.startsWith('.') ? `*${rule}` : rule;
    return globMatches(glob, name);
  });
}

function isImplicitlyDirect(name: string): boolean {
  return (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    name === '::1' ||
    (isIP(name) === 4 && (name.startsWith('127.') || name.startsWith('169.254.'))) ||
    (isIP(name) === 6 && /^fe[89ab]/.test(name))
  );
}

function globMatches(glob: string, name: string): boolean {
  const source = glob
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`).test(name);
}

// Lowercase, without the brackets a URL puts around an IPv6 address.
function normalize(host: string): string {
  return host.toLowerCase().replace(/^\[(.*)\]$/, '$1');
}
