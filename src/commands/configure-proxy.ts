import type { ProxyConfiguration, ProxyCredentials } from '../types/proxy-configuration';
import type { ProxyManager } from '../services/proxy-manager';
import { KeychainError } from '../services/keychain-service';
import { ValidationError, ValidationService } from '../services/validation-service';
import type {
  NotificationAction,
  NotificationService as NotificationServiceService
} from '../ui/notification-service';

const DEFAULT_NO_PROXY = 'localhost,127.0.0.1';
const MASKED_CREDENTIALS_PLACEHOLDER = '••••••';

type InputBoxOptions = {
  prompt: string;
  value?: string;
  placeHolder?: string;
  password?: boolean;
  ignoreFocusOut?: boolean;
  validateInput?: (value: string) => string | undefined;
};

type QuickPickItem = {
  label: string;
  description?: string;
  detail?: string;
};

type QuickPickOptions = {
  placeHolder?: string;
  ignoreFocusOut?: boolean;
};

type VscodeApi = {
  l10n: {
    t: (message: string, ...args: (string | number)[]) => string;
  };
  window: {
    showInputBox: (options: InputBoxOptions) => Promise<string | undefined>;
    showQuickPick: <T extends QuickPickItem>(
      items: readonly T[],
      options: QuickPickOptions
    ) => Promise<T | undefined>;
  };
  commands: {
    executeCommand: (command: string, ...args: unknown[]) => PromiseLike<unknown>;
  };
};

type CredentialsUpdate =
  { mode: 'keep' } | { mode: 'clear' } | { mode: 'set'; credentials: ProxyCredentials };

type NotificationService = Pick<
  NotificationServiceService,
  'showSuccess' | 'showWarning' | 'showError'
>;

type RefreshUi = () => Promise<void>;

const ACTION_ENABLE: NotificationAction = { id: 'enable', title: 'Enable' };
const ACTION_NOT_NOW: NotificationAction = { id: 'notNow', title: 'Not Now' };

/**
 * Prompts the user to configure proxy settings and saves them securely.
 *
 * Credentials are stored in SecretStorage (OS keychain) and are never displayed back to the user.
 *
 * @param vscodeApi VS Code API surface used for prompts and command execution.
 * @param proxyManager ProxyManager instance.
 * @param notificationService Notification helper (localized UI).
 * @param refreshUi Callback to refresh status bar and context keys.
 * @returns void
 * @throws {Error} If VS Code APIs reject unexpectedly.
 * @example
 * ```ts
 * await configureProxyCommand(vscode, proxyManager, notifications, refreshUi);
 * ```
 */
export async function configureProxyCommand(
  vscodeApi: VscodeApi,
  proxyManager: ProxyManager,
  notificationService: NotificationService,
  refreshUi: RefreshUi
): Promise<void> {
  const existing = await proxyManager.loadConfiguration();

  const proxyUrl = await promptForProxyUrl(vscodeApi, existing?.proxyUrl);
  if (proxyUrl === undefined) {
    return;
  }

  const credentialsUpdate = await promptForCredentialsUpdate(
    vscodeApi,
    notificationService,
    existing?.hasStoredCredentials ?? false
  );
  if (credentialsUpdate === undefined) {
    return;
  }

  const strictSSL = await promptForStrictSSL(vscodeApi, existing?.strictSSL);
  if (strictSSL === undefined) {
    return;
  }

  const noProxyInput = await promptForNoProxy(vscodeApi, existing?.noProxy);
  if (noProxyInput === undefined) {
    return;
  }

  const configuration: ProxyConfiguration = {
    proxyUrl,
    strictSSL,
    noProxy: normalizeNoProxy(noProxyInput)
  };

  try {
    await saveConfiguration(proxyManager, configuration, credentialsUpdate);
  } catch (error: unknown) {
    await showConfigurationSaveError(notificationService, error);
    return;
  }

  await refreshUi();
  const enableNow = await notificationService.showSuccess(
    'Proxy configuration saved. Enable now?',
    ACTION_ENABLE,
    ACTION_NOT_NOW
  );

  if (enableNow === ACTION_ENABLE.id) {
    await vscodeApi.commands.executeCommand('proxyToggler.enable');
  }
}

async function promptForProxyUrl(
  vscodeApi: VscodeApi,
  initialValue?: string
): Promise<string | undefined> {
  return vscodeApi.window.showInputBox({
    prompt: vscodeApi.l10n.t('Enter proxy URL (e.g., http://proxy.example.com:8080)'),
    placeHolder: vscodeApi.l10n.t('http://proxy.example.com:8080'),
    ignoreFocusOut: true,
    value: initialValue,
    validateInput: (value) => validateProxyUrlInput(vscodeApi, value)
  });
}

function validateProxyUrlInput(vscodeApi: VscodeApi, value: string): string | undefined {
  try {
    ValidationService.validateProxyUrl(value);
    return undefined;
  } catch (error: unknown) {
    if (error instanceof ValidationError) {
      return vscodeApi.l10n.t(error.message);
    }
    return vscodeApi.l10n.t('Invalid proxy URL');
  }
}

async function promptForCredentialsUpdate(
  vscodeApi: VscodeApi,
  notificationService: NotificationService,
  hasStoredCredentials: boolean
): Promise<CredentialsUpdate | undefined> {
  if (hasStoredCredentials) {
    return promptForCredentialAction(vscodeApi, notificationService);
  }

  const username = await promptForUsername(vscodeApi);
  if (username === undefined) {
    return undefined;
  }

  if (username.trim().length === 0) {
    return { mode: 'keep' };
  }

  const password = await promptForPassword(vscodeApi);
  if (password === undefined) {
    return undefined;
  }

  try {
    ValidationService.validateCredentials(username, password);
  } catch (error: unknown) {
    await showValidationError(notificationService, error);
    return undefined;
  }

  return { mode: 'set', credentials: { username, password } };
}

async function promptForCredentialAction(
  vscodeApi: VscodeApi,
  notificationService: NotificationService
): Promise<CredentialsUpdate | undefined> {
  const items = [
    {
      label: vscodeApi.l10n.t('Keep existing credentials'),
      description: vscodeApi.l10n.t(`Stored: ${MASKED_CREDENTIALS_PLACEHOLDER}`),
      detail: vscodeApi.l10n.t('Keep the saved username/password unchanged.'),
      id: 'keep'
    },
    {
      label: vscodeApi.l10n.t('Update credentials'),
      description: vscodeApi.l10n.t('Replace saved username/password'),
      detail: vscodeApi.l10n.t('Enter a new username and password.'),
      id: 'set'
    },
    {
      label: vscodeApi.l10n.t('Remove credentials'),
      description: vscodeApi.l10n.t('Clear saved username/password'),
      detail: vscodeApi.l10n.t('Use if your proxy no longer requires authentication.'),
      id: 'clear'
    }
  ] as const;

  const choice = await vscodeApi.window.showQuickPick(items, {
    placeHolder: vscodeApi.l10n.t('Proxy authentication credentials')
  });

  if (!choice) {
    return undefined;
  }

  if (choice.id === 'keep') {
    return { mode: 'keep' };
  }

  if (choice.id === 'clear') {
    return { mode: 'clear' };
  }

  const username = await promptForUsername(vscodeApi, {
    prompt: vscodeApi.l10n.t('Enter proxy username (leave empty to remove credentials)')
  });
  if (username === undefined) {
    return undefined;
  }

  if (username.trim().length === 0) {
    return { mode: 'clear' };
  }

  const password = await promptForPassword(vscodeApi);
  if (password === undefined) {
    return undefined;
  }

  try {
    ValidationService.validateCredentials(username, password);
  } catch (error: unknown) {
    await showValidationError(notificationService, error);
    return undefined;
  }

  return { mode: 'set', credentials: { username, password } };
}

async function promptForUsername(
  vscodeApi: VscodeApi,
  overrides?: Pick<InputBoxOptions, 'prompt'>
): Promise<string | undefined> {
  return vscodeApi.window.showInputBox({
    prompt:
      overrides?.prompt ??
      vscodeApi.l10n.t('Enter proxy username (leave empty if no authentication)'),
    placeHolder: vscodeApi.l10n.t('username (optional)'),
    ignoreFocusOut: true
  });
}

async function promptForPassword(vscodeApi: VscodeApi): Promise<string | undefined> {
  return vscodeApi.window.showInputBox({
    prompt: vscodeApi.l10n.t('Enter proxy password'),
    placeHolder: vscodeApi.l10n.t('password'),
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => validatePasswordInput(vscodeApi, value)
  });
}

function validatePasswordInput(vscodeApi: VscodeApi, value: string): string | undefined {
  if (value.trim().length === 0) {
    return vscodeApi.l10n.t('Password is required');
  }
  return undefined;
}

async function promptForStrictSSL(
  vscodeApi: VscodeApi,
  initialValue?: boolean
): Promise<boolean | undefined> {
  const items = buildStrictSSLItems(vscodeApi, initialValue);

  const choice = await vscodeApi.window.showQuickPick(items, {
    placeHolder: vscodeApi.l10n.t('Verify SSL/TLS certificates?')
  });

  return choice?.value;
}

function buildStrictSSLItems(
  vscodeApi: VscodeApi,
  initialValue?: boolean
): Array<QuickPickItem & { value: boolean }> {
  const yes = {
    label: vscodeApi.l10n.t('Yes'),
    value: true,
    description: vscodeApi.l10n.t('Verify SSL certificates (recommended)')
  };
  const no = {
    label: vscodeApi.l10n.t('No'),
    value: false,
    description: vscodeApi.l10n.t('Skip SSL verification (insecure)')
  };

  if (initialValue === false) {
    return [no, yes];
  }

  return [yes, no];
}

async function promptForNoProxy(
  vscodeApi: VscodeApi,
  initialValue?: string
): Promise<string | undefined> {
  return vscodeApi.window.showInputBox({
    prompt: vscodeApi.l10n.t('Enter domains/IPs to bypass proxy (comma-separated, optional)'),
    placeHolder: DEFAULT_NO_PROXY,
    ignoreFocusOut: true,
    value: initialValue ?? DEFAULT_NO_PROXY,
    validateInput: (value) => validateNoProxyInput(vscodeApi, value)
  });
}

function validateNoProxyInput(vscodeApi: VscodeApi, value: string): string | undefined {
  try {
    ValidationService.validateNoProxyPattern(value);
    return undefined;
  } catch (error: unknown) {
    if (error instanceof ValidationError) {
      return vscodeApi.l10n.t(error.message);
    }
    return vscodeApi.l10n.t('Invalid bypass pattern');
  }
}

function normalizeNoProxy(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_NO_PROXY;
}

async function saveConfiguration(
  proxyManager: ProxyManager,
  configuration: ProxyConfiguration,
  credentialsUpdate: CredentialsUpdate
): Promise<void> {
  if (credentialsUpdate.mode === 'keep') {
    await proxyManager.saveConfiguration({ configuration });
    return;
  }

  if (credentialsUpdate.mode === 'clear') {
    await proxyManager.saveConfiguration({ configuration, clearCredentials: true });
    return;
  }

  await proxyManager.saveConfiguration({
    configuration,
    credentials: credentialsUpdate.credentials
  });
}

async function showConfigurationSaveError(
  notificationService: NotificationService,
  error: unknown
): Promise<void> {
  if (error instanceof ValidationError) {
    await showValidationError(notificationService, error);
    return;
  }

  if (error instanceof KeychainError) {
    await notificationService.showError(error.toUserMessage());
    return;
  }

  await notificationService.showError('Failed to save proxy configuration.');
}

async function showValidationError(
  notificationService: NotificationService,
  error: unknown
): Promise<void> {
  if (error instanceof ValidationError) {
    const message = error.examples?.length
      ? `${error.message} Examples: ${error.examples.join(', ')}`
      : error.message;
    await notificationService.showError(message);
    return;
  }

  await notificationService.showError('Invalid configuration input.');
}
