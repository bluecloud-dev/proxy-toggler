export const COMMANDS = {
  configure: 'proxyToggler.configure',
  enable: 'proxyToggler.enable',
  disable: 'proxyToggler.disable',
  toggle: 'proxyToggler.toggle'
} as const;

export const CONTEXT_KEYS = {
  hasConfiguration: 'proxyToggler.hasConfiguration',
  isEnabled: 'proxyToggler.isEnabled'
} as const;
