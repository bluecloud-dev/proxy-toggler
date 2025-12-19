import { isIP } from 'node:net';

const PROXY_URL_EXAMPLES = ['http://proxy.example.com:8080', 'https://10.0.0.1:3128'];
const NO_PROXY_EXAMPLES = ['localhost', '127.0.0.1', '*.example.com', '.example.com'];

export class ValidationError extends Error {
  /**
   * @param field The field being validated (e.g., `proxyUrl`, `noProxy`).
   * @param reason A human-readable reason for the validation failure.
   * @param examples Optional examples to help the user correct their input.
   * @example
   * ```ts
   * throw new ValidationError('proxyUrl', 'Port is required', ['http://proxy:8080']);
   * ```
   */
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
  /**
   * Validates a proxy URL string.
   *
   * Rules:
   * - Must be `http://` or `https://`
   * - Must include hostname and port
   * - Must not include credentials, path, query, or fragment
   *
   * @param url Proxy URL including port.
   * @returns void
   * @throws {ValidationError} If the URL is missing or invalid.
   * @example
   * ```ts
   * ValidationService.validateProxyUrl('http://proxy.example.com:8080');
   * ```
   */
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

    if (trimmedUrl.endsWith('/') || parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
      throw new ValidationError('proxyUrl', 'URL must not include a path, query, or fragment');
    }
  }

  /**
   * Validates username/password pairing.
   *
   * @param username Proxy username (optional).
   * @param password Proxy password (optional).
   * @returns void
   * @throws {ValidationError} If only one of username/password is provided.
   * @example
   * ```ts
   * ValidationService.validateCredentials('alice', 'secret');
   * ```
   */
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

  /**
   * Validates a comma-separated `noProxy` bypass list.
   *
   * Supported entries:
   * - hostnames and IP literals
   * - domain suffixes (e.g. `.example.com`)
   * - wildcard subdomains (e.g. `*.example.com`)
   *
   * CIDR patterns are out of scope for v1.
   *
   * @param noProxy Comma-separated bypass patterns.
   * @returns void
   * @throws {ValidationError} If any entry is invalid.
   * @example
   * ```ts
   * ValidationService.validateNoProxyPattern('localhost,127.0.0.1,*.example.com');
   * ```
   */
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

  /**
   * Validates a TCP port number.
   *
   * @param port TCP port.
   * @returns void
   * @throws {ValidationError} If the port is outside 1-65535.
   * @example
   * ```ts
   * ValidationService.validatePort(8080);
   * ```
   */
  static validatePort(port: number): void {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ValidationError('proxyUrl', 'Port must be between 1 and 65535', PROXY_URL_EXAMPLES);
    }
  }

  /**
   * Validates the URL scheme is `http` or `https`.
   *
   * @param protocol URL protocol string (e.g. `http:`).
   * @returns void
   * @throws {ValidationError} If the scheme is not supported.
   * @example
   * ```ts
   * ValidationService.validateScheme('https:');
   * ```
   */
  static validateScheme(protocol: string): void {
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new ValidationError('proxyUrl', 'Scheme must be http or https', PROXY_URL_EXAMPLES);
    }
  }

  private static validateSingleNoProxyEntry(entry: string): void {
    if (entry.includes('://')) {
      throw new ValidationError('noProxy', `Do not include a scheme in "${entry}"`, NO_PROXY_EXAMPLES);
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
      throw new ValidationError('noProxy', `Invalid wildcard pattern: "${entry}"`, NO_PROXY_EXAMPLES);
    }

    if (entry.startsWith('*.') && entry.slice(2).startsWith('.')) {
      throw new ValidationError('noProxy', `Invalid wildcard pattern: "${entry}"`, NO_PROXY_EXAMPLES);
    }

    const core = ValidationService.extractNoProxyCore(entry);

    if (isIP(core) !== 0) {
      if (entry !== core) {
        throw new ValidationError('noProxy', `Invalid bypass pattern: "${entry}"`, NO_PROXY_EXAMPLES);
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
