/**
 * Non-sensitive proxy configuration persisted in VS Code `globalState`.
 *
 * Credentials are stored separately in `SecretStorage` and MUST NOT appear here.
 */
export type ProxyConfiguration = {
  /** Proxy URL including port, e.g. `http://proxy.example.com:8080`. */
  proxyUrl: string;
  /** When true, VS Code verifies proxy TLS certificates (recommended). */
  strictSSL: boolean;
  /** Comma-separated bypass list (VS Code `http.noProxy`). */
  noProxy: string;
};

/**
 * Proxy credentials stored only in VS Code `SecretStorage` (OS keychain).
 */
export type ProxyCredentials = {
  username: string;
  password: string;
};
