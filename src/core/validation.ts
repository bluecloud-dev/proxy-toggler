import { isIP } from 'node:net';

const PROXY_URL_EXAMPLES = [
  'http://proxy.example.com:8080',
  'https://10.0.0.1:3128',
  'socks5://proxy.example.com:1080'
];

const SUPPORTED_SCHEMES = ['http:', 'https:', 'socks:', 'socks5:'];

// The VS Code window rejects socks4a and socks5h, and with socks4 the window and extensions
// resolve host names in different places.
const REFUSED_SOCKS_SCHEMES = ['socks4:', 'socks4a:', 'socks5h:'];
const NO_PROXY_EXAMPLES = ['localhost', '127.0.0.1', '*.example.com', '.example.com'];

export type ValidatedField = 'proxyUrl' | 'noProxy' | 'name';

export class ValidationError extends Error {
  constructor(
    public readonly field: ValidatedField,
    public readonly reason: string,
    public readonly examples?: readonly string[]
  ) {
    super(`Invalid ${field}: ${reason}`);
    this.name = 'ValidationError';
  }
}

export function validateProxyUrl(url: string): void {
  const invalidUrl = (reason: string): ValidationError =>
    new ValidationError('proxyUrl', reason, PROXY_URL_EXAMPLES);

  if (typeof url !== 'string' || url.trim().length === 0) {
    throw invalidUrl('URL is required');
  }

  const trimmedUrl = url.trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw invalidUrl('Invalid URL format');
  }

  if (REFUSED_SOCKS_SCHEMES.includes(parsedUrl.protocol)) {
    throw invalidUrl(
      'socks4, socks4a and socks5h proxies are not supported: the VS Code window rejects socks4a and socks5h, and with socks4 the window and extensions resolve host names in different places'
    );
  }

  if (!SUPPORTED_SCHEMES.includes(parsedUrl.protocol)) {
    throw invalidUrl('Scheme must be http, https, socks or socks5');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new ValidationError('proxyUrl', 'Credentials must not be included in the URL');
  }

  if (!parsedUrl.hostname) {
    throw invalidUrl('Missing hostname');
  }

  const portText = explicitPort(trimmedUrl, parsedUrl);
  if (!portText) {
    throw invalidUrl('Port number is required');
  }

  const port = Number.parseInt(portText, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw invalidUrl('Port must be between 1 and 65535');
  }

  // An http or https URL always has the path "/"; a socks URL has an empty one.
  if (
    trimmedUrl.endsWith('/') ||
    !['', '/'].includes(parsedUrl.pathname) ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new ValidationError('proxyUrl', 'URL must not include a path, query, or fragment');
  }
}

// The URL parser drops a port equal to the scheme default; http and https differ only in that
// default, so reparsing the text as the other scheme keeps the port the user typed. It keeps any
// port of a socks URL, whose scheme it does not know.
function explicitPort(url: string, parsedUrl: URL): string {
  if (parsedUrl.port || !['http:', 'https:'].includes(parsedUrl.protocol)) {
    return parsedUrl.port;
  }
  const otherScheme = parsedUrl.protocol === 'http:' ? 'https:' : 'http:';
  return new URL(url.replace(/^[^:]*:/, otherScheme)).port;
}

export function validateBypassPattern(entry: string): void {
  const invalidEntry = (reason: string): ValidationError =>
    new ValidationError('noProxy', reason, NO_PROXY_EXAMPLES);

  if (entry.includes('://')) {
    throw invalidEntry(`Do not include a scheme in "${entry}"`);
  }

  if (entry.includes('/')) {
    throw invalidEntry('CIDR notation is not supported in v1');
  }

  if (entry === '*' || entry === '*.') {
    throw invalidEntry(`Invalid bypass pattern: "${entry}"`);
  }

  if (entry.includes('*') && !isWellFormedWildcard(entry)) {
    throw invalidEntry(`Invalid wildcard pattern: "${entry}"`);
  }

  const host = stripPatternPrefix(entry);
  // IP literals take neither a "*." nor a "." prefix.
  const isValid = isIP(host) !== 0 ? entry === host : isValidHostname(host);
  if (!isValid) {
    throw invalidEntry(`Invalid bypass pattern: "${entry}"`);
  }
}

// The only wildcard form is a single leading "*." followed by a domain.
function isWellFormedWildcard(entry: string): boolean {
  const domain = entry.slice(2);
  return entry.startsWith('*.') && !domain.includes('*') && !domain.startsWith('.');
}

function stripPatternPrefix(entry: string): string {
  const withoutWildcard = entry.startsWith('*.') ? entry.slice(2) : entry;
  const withoutDot = withoutWildcard.startsWith('.') ? withoutWildcard.slice(1) : withoutWildcard;
  return withoutDot.trim();
}

function isValidHostname(value: string): boolean {
  if (
    value.length === 0 ||
    value.startsWith('.') ||
    value.endsWith('.') ||
    value.includes('..') ||
    value.includes('@')
  ) {
    return false;
  }

  try {
    const url = new URL(`http://${value}`);
    return url.hostname.length > 0 && url.port.length === 0;
  } catch {
    return false;
  }
}

// The reason a validation fails, or undefined when it passes. Errors other than ValidationError
// are not the input's fault, so they go on.
export function problemWith(validate: () => void): string | undefined {
  try {
    validate();
    return undefined;
  } catch (error: unknown) {
    if (error instanceof ValidationError) {
      return error.reason;
    }
    throw error;
  }
}
