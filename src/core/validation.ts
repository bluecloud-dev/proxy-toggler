import { isIP } from 'node:net';

import { parseNoProxyList } from './no-proxy';

const PROXY_URL_EXAMPLES = ['http://proxy.example.com:8080', 'https://10.0.0.1:3128'];
const NO_PROXY_EXAMPLES = ['localhost', '127.0.0.1', '*.example.com', '.example.com'];

export type ValidatedField = 'proxyUrl' | 'credentials' | 'noProxy';

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

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw invalidUrl('Scheme must be http or https');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new ValidationError('proxyUrl', 'Credentials must not be included in the URL');
  }

  if (!parsedUrl.hostname) {
    throw invalidUrl('Missing hostname');
  }

  if (!parsedUrl.port) {
    throw invalidUrl('Port number is required');
  }

  const port = Number.parseInt(parsedUrl.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw invalidUrl('Port must be between 1 and 65535');
  }

  if (
    trimmedUrl.endsWith('/') ||
    parsedUrl.pathname !== '/' ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new ValidationError('proxyUrl', 'URL must not include a path, query, or fragment');
  }
}

export function validateCredentials(username?: string, password?: string): void {
  const hasUsername = typeof username === 'string' && username.trim().length > 0;
  const hasPassword = typeof password === 'string' && password.trim().length > 0;

  if (hasUsername !== hasPassword) {
    throw new ValidationError(
      'credentials',
      'Username and password must both be provided or both be omitted'
    );
  }
}

export function validateNoProxyList(noProxy?: string): void {
  for (const entry of parseNoProxyList(noProxy)) {
    validateNoProxyEntry(entry);
  }
}

function validateNoProxyEntry(entry: string): void {
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
