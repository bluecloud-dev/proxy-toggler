// Persisted in globalState, so it must never hold credentials: those live only in SecretStorage.
export type ProxyConfiguration = {
  proxyUrl: string;
  strictSSL: boolean;
  noProxy: string;
};

export type ProxyCredentials = {
  username: string;
  password: string;
};

export type ToggleState = {
  isEnabled: boolean;
  hasConfiguration: boolean;
};
