import { isIP } from 'node:net';

const PROXY_URL_EXAMPLES = ['http://proxy.example.com:8080', 'https://10.0.0.1:3128'];
const NO_PROXY_EXAMPLES = ['localhost', '127.0.0.1', '*.example.com', '.example.com'];

export class ValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly reason: string,
    public readonly examples?: string[]
  ) {
    super(`Invalid ${field}: ${reason}`);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationService {
  static validateProxyUrl(url: string): void {
    if (typeof url !== 'string' || url.trim().length === 0) {
      throw new ValidationError('proxyUrl', 'URL is required', PROXY_URL_EXAMPLES);
    }

    const trimmedUrl = url.trim();

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmedUrl);
    } catch {
      throw new ValidationError('proxyUrl', 'Invalid URL format', PROXY_URL_EXAMPLES);
    }

    ValidationService.validateScheme(parsedUrl.protocol);

    if (parsedUrl.username.length > 0 || parsedUrl.password.length > 0) {
      throw new ValidationError('proxyUrl', 'Credentials must not be included in the URL');
    }

    if (!parsedUrl.hostname) {
      throw new ValidationError('proxyUrl', 'Missing hostname', PROXY_URL_EXAMPLES);
    }

    if (parsedUrl.port.length === 0) {
      throw new ValidationError('proxyUrl', 'Port number is required', PROXY_URL_EXAMPLES);
    }

    const port = Number.parseInt(parsedUrl.port, 10);
    ValidationService.validatePort(port);

    if (
      trimmedUrl.endsWith('/') ||
      parsedUrl.pathname !== '/' ||
      parsedUrl.search ||
      parsedUrl.hash
    ) {
      throw new ValidationError('proxyUrl', 'URL must not include a path, query, or fragment');
    }
  }

  static validateCredentials(username?: string, password?: string): void {
    const hasUsername = typeof username === 'string' && username.trim().length > 0;
    const hasPassword = typeof password === 'string' && password.trim().length > 0;

    if (hasUsername !== hasPassword) {
      throw new ValidationError(
        'credentials',
        'Username and password must both be provided or both be omitted'
      );
    }
  }

  static validateNoProxyPattern(noProxy?: string): void {
    if (noProxy === undefined || noProxy.trim().length === 0) {
      return;
    }

    const patterns = noProxy
      .split(',')
      .map((pattern) => pattern.trim())
      .filter((pattern) => pattern.length > 0);

    for (const pattern of patterns) {
      ValidationService.validateSingleNoProxyEntry(pattern);
    }
  }

  static validatePort(port: number): void {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ValidationError('proxyUrl', 'Port must be between 1 and 65535', PROXY_URL_EXAMPLES);
    }
  }

  static validateScheme(protocol: string): void {
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new ValidationError('proxyUrl', 'Scheme must be http or https', PROXY_URL_EXAMPLES);
    }
  }

  private static validateSingleNoProxyEntry(entry: string): void {
    if (entry.includes('://')) {
      throw new ValidationError(
        'noProxy',
        `Do not include a scheme in "${entry}"`,
        NO_PROXY_EXAMPLES
      );
    }

    if (entry.includes('/')) {
      throw new ValidationError(
        'noProxy',
        'CIDR notation is not supported in v1',
        NO_PROXY_EXAMPLES
      );
    }

    if (entry === '*' || entry === '*.') {
      throw new ValidationError('noProxy', `Invalid bypass pattern: "${entry}"`, NO_PROXY_EXAMPLES);
    }

    if (entry.includes('*') && (!entry.startsWith('*.') || entry.slice(2).includes('*'))) {
      throw new ValidationError(
        'noProxy',
        `Invalid wildcard pattern: "${entry}"`,
        NO_PROXY_EXAMPLES
      );
    }

    if (entry.startsWith('*.') && entry.slice(2).startsWith('.')) {
      throw new ValidationError(
        'noProxy',
        `Invalid wildcard pattern: "${entry}"`,
        NO_PROXY_EXAMPLES
      );
    }

    const core = ValidationService.extractNoProxyCore(entry);

    if (isIP(core) !== 0) {
      if (entry !== core) {
        throw new ValidationError(
          'noProxy',
          `Invalid bypass pattern: "${entry}"`,
          NO_PROXY_EXAMPLES
        );
      }
      return;
    }

    if (!isValidHostname(core)) {
      throw new ValidationError('noProxy', `Invalid bypass pattern: "${entry}"`, NO_PROXY_EXAMPLES);
    }
  }

  private static extractNoProxyCore(entry: string): string {
    const wildcardTrimmed = entry.startsWith('*.') ? entry.slice(2) : entry;
    const domainSuffixTrimmed = wildcardTrimmed.startsWith('.')
      ? wildcardTrimmed.slice(1)
      : wildcardTrimmed;

    return domainSuffixTrimmed.trim();
  }
}

function isValidHostname(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  if (value.startsWith('.') || value.endsWith('.')) {
    return false;
  }

  if (value.includes('..')) {
    return false;
  }

  if (value.includes('@')) {
    return false;
  }

  try {
    const url = new URL(`http://${value}`);
    return url.hostname.length > 0 && url.port.length === 0;
  } catch {
    return false;
  }
}
