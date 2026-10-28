export const COMMANDS = {
  configure: 'proxyToggler.configure',
  enable: 'proxyToggler.enable',
  disable: 'proxyToggler.disable',
  toggle: 'proxyToggler.toggle',
  switchProfile: 'proxyToggler.switchProfile'
} as const;

export const EXTENSION_ID = 'bluecloud-dev.proxy-toggler';

export const CONTEXT_KEYS = {
  hasConfiguration: 'proxyToggler.hasConfiguration',
  isEnabled: 'proxyToggler.isEnabled',
  // VS Code's settings carry a proxy that matches no profile.
  hasDrift: 'proxyToggler.hasDrift'
} as const;
