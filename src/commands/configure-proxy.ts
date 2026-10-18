import type { QuickPickItem } from 'vscode';

import { KeychainError } from '../core/keychain-service';
import { DEFAULT_NO_PROXY } from '../core/no-proxy';
import type { CredentialsUpdate, ProxyManager } from '../core/proxy-manager';
import {
  validateCredentials,
  validateNoProxyList,
  validateProxyUrl,
  ValidationError
} from '../core/validation';
import type { VscodeApi } from '../vscode/api';
import type { NotificationAction, Notifier } from '../vscode/notification-service';
import { COMMANDS } from './command-ids';

// Stored credentials are never read back for display; the UI shows only this mask.
const MASKED_CREDENTIALS_PLACEHOLDER = '••••••';

const ACTION_ENABLE: NotificationAction = { id: 'enable', title: 'Enable' };
const ACTION_NOT_NOW: NotificationAction = { id: 'notNow', title: 'Not Now' };

type ConfigureApi = Pick<VscodeApi, 'commands' | 'l10n' | 'window'>;

export async function configureProxyCommand(
  vscodeApi: ConfigureApi,
  proxyManager: Pick<ProxyManager, 'loadConfiguration' | 'saveConfiguration'>,
  notificationService: Notifier,
  refreshUi: () => Promise<void>
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

  const noProxy = await promptForNoProxy(vscodeApi, existing?.noProxy);
  if (noProxy === undefined) {
    return;
  }

  try {
    await proxyManager.saveConfiguration({ proxyUrl, strictSSL, noProxy }, credentialsUpdate);
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
    validateInput: inputValidator(
      vscodeApi,
      validateProxyUrl,
      vscodeApi.l10n.t('Invalid proxy URL')
    )
  });
}

async function promptForCredentialsUpdate(
  vscodeApi: ConfigureApi,
  notificationService: Notifier,
  hasStoredCredentials: boolean
): Promise<CredentialsUpdate | undefined> {
  if (!hasStoredCredentials) {
    return promptForNewCredentials(vscodeApi, notificationService, {
      usernamePrompt: vscodeApi.l10n.t('Enter proxy username (leave empty if no authentication)'),
      whenUsernameEmpty: { mode: 'keep' }
    });
  }

  const choice = await vscodeApi.window.showQuickPick(storedCredentialChoices(vscodeApi), {
    placeHolder: vscodeApi.l10n.t('Proxy authentication credentials')
  });
  if (!choice) {
    return undefined;
  }

  if (choice.id !== 'set') {
    return { mode: choice.id };
  }

  return promptForNewCredentials(vscodeApi, notificationService, {
    usernamePrompt: vscodeApi.l10n.t('Enter proxy username (leave empty to remove credentials)'),
    whenUsernameEmpty: { mode: 'clear' }
  });
}

function storedCredentialChoices(vscodeApi: ConfigureApi) {
  return [
    {
      label: vscodeApi.l10n.t('Keep existing credentials'),
      description: vscodeApi.l10n.t('Stored: {0}', MASKED_CREDENTIALS_PLACEHOLDER),
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
}

async function promptForNewCredentials(
  vscodeApi: ConfigureApi,
  notificationService: Notifier,
  options: { usernamePrompt: string; whenUsernameEmpty: CredentialsUpdate }
): Promise<CredentialsUpdate | undefined> {
  const username = await vscodeApi.window.showInputBox({
    prompt: options.usernamePrompt,
    placeHolder: vscodeApi.l10n.t('username (optional)'),
    ignoreFocusOut: true
  });
  if (username === undefined) {
    return undefined;
  }

  if (username.trim().length === 0) {
    return options.whenUsernameEmpty;
  }

  const password = await vscodeApi.window.showInputBox({
    prompt: vscodeApi.l10n.t('Enter proxy password'),
    placeHolder: vscodeApi.l10n.t('password'),
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim().length === 0 ? vscodeApi.l10n.t('Password is required') : undefined
  });
  if (password === undefined) {
    return undefined;
  }

  try {
    validateCredentials(username, password);
  } catch (error: unknown) {
    await showValidationError(notificationService, error);
    return undefined;
  }

  return { mode: 'set', credentials: { username, password } };
}

async function promptForStrictSSL(
  vscodeApi: ConfigureApi,
  initialValue?: boolean
): Promise<boolean | undefined> {
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
  // The current choice comes first so that Enter keeps it.
  const items: Array<QuickPickItem & { value: boolean }> =
    initialValue === false ? [no, yes] : [yes, no];

  const choice = await vscodeApi.window.showQuickPick(items, {
    placeHolder: vscodeApi.l10n.t('Verify SSL/TLS certificates?')
  });
  return choice?.value;
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
    validateInput: inputValidator(
      vscodeApi,
      validateNoProxyList,
      vscodeApi.l10n.t('Invalid bypass pattern')
    )
  });
}

// Adapts a throwing validator to VS Code's validateInput, which returns a message or undefined.
function inputValidator(
  vscodeApi: ConfigureApi,
  validate: (value: string) => void,
  fallbackMessage: string
): (value: string) => string | undefined {
  return (value) => {
    try {
      validate(value);
      return undefined;
    } catch (error: unknown) {
      return error instanceof ValidationError ? vscodeApi.l10n.t(error.message) : fallbackMessage;
    }
  };
}

async function showConfigurationSaveError(
  notificationService: Notifier,
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

async function showValidationError(notificationService: Notifier, error: unknown): Promise<void> {
  if (!(error instanceof ValidationError)) {
    await notificationService.showError('Invalid configuration input.');
    return;
  }

  const examples = error.examples?.length ? ` Examples: ${error.examples.join(', ')}` : '';
  await notificationService.showError(`${error.message}${examples}`);
}
