export const COMMANDS = {
  configure: 'proxyToggler.configure',
  enable: 'proxyToggler.enable',
  disable: 'proxyToggler.disable',
  toggle: 'proxyToggler.toggle',
  switchProfile: 'proxyToggler.switchProfile'
} as const;

export const EXTENSION_ID = 'aymenhammouda.proxy-toggler';

export const CONTEXT_KEYS = {
  hasConfiguration: 'proxyToggler.hasConfiguration',
  isEnabled: 'proxyToggler.isEnabled'
} as const;
