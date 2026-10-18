import type { InputBoxOptions, QuickPickItem } from 'vscode';

import { KeychainError } from '../core/keychain-service';
import type { ProxyConfiguration, ProxyCredentials } from '../core/proxy-configuration';
import type { ProxyManager as ProxyManagerService } from '../core/proxy-manager';
import { ValidationError, ValidationService } from '../core/validation-service';
import type { VscodeApi } from '../vscode/api';
import type {
  NotificationAction,
  NotificationService as NotificationServiceService
} from '../vscode/notification-service';
import { COMMANDS } from './command-ids';

const DEFAULT_NO_PROXY = 'localhost,127.0.0.1';
// Stored credentials are never read back for display; the UI shows only this mask.
const MASKED_CREDENTIALS_PLACEHOLDER = '••••••';

type ConfigureApi = Pick<VscodeApi, 'commands' | 'l10n' | 'window'>;

type ProxyManager = Pick<ProxyManagerService, 'loadConfiguration' | 'saveConfiguration'>;

type CredentialsUpdate =
  { mode: 'keep' } | { mode: 'clear' } | { mode: 'set'; credentials: ProxyCredentials };

type NotificationService = Pick<
  NotificationServiceService,
  'showSuccess' | 'showWarning' | 'showError'
>;

type RefreshUi = () => Promise<void>;

const ACTION_ENABLE: NotificationAction = { id: 'enable', title: 'Enable' };
const ACTION_NOT_NOW: NotificationAction = { id: 'notNow', title: 'Not Now' };

export async function configureProxyCommand(
  vscodeApi: ConfigureApi,
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
    await vscodeApi.commands.executeCommand(COMMANDS.enable);
  }
}

async function promptForProxyUrl(
  vscodeApi: ConfigureApi,
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

function validateProxyUrlInput(vscodeApi: ConfigureApi, value: string): string | undefined {
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
  vscodeApi: ConfigureApi,
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
  vscodeApi: ConfigureApi,
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
  vscodeApi: ConfigureApi,
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

async function promptForPassword(vscodeApi: ConfigureApi): Promise<string | undefined> {
  return vscodeApi.window.showInputBox({
    prompt: vscodeApi.l10n.t('Enter proxy password'),
    placeHolder: vscodeApi.l10n.t('password'),
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => validatePasswordInput(vscodeApi, value)
  });
}

function validatePasswordInput(vscodeApi: ConfigureApi, value: string): string | undefined {
  if (value.trim().length === 0) {
    return vscodeApi.l10n.t('Password is required');
  }
  return undefined;
}

async function promptForStrictSSL(
  vscodeApi: ConfigureApi,
  initialValue?: boolean
): Promise<boolean | undefined> {
  const items = buildStrictSSLItems(vscodeApi, initialValue);

  const choice = await vscodeApi.window.showQuickPick(items, {
    placeHolder: vscodeApi.l10n.t('Verify SSL/TLS certificates?')
  });

  return choice?.value;
}

function buildStrictSSLItems(
  vscodeApi: ConfigureApi,
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
  vscodeApi: ConfigureApi,
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

function validateNoProxyInput(vscodeApi: ConfigureApi, value: string): string | undefined {
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
