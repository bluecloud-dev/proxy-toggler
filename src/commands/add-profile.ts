import { valuesFromSettings } from '../core/from-settings';
import { defaultProfileName, type Profile, validateProfileName } from '../core/profiles';
import type { ProxyManager } from '../core/proxy-manager';
import type { Saved } from '../core/proxy-outcome';
import { problemWith, validateProxyUrl } from '../core/validation';
import type { VscodeApi } from '../vscode/api';
import type { NotificationAction, Notifier } from '../vscode/notification-service';
import { askText, BACK } from '../vscode/quick-input';
import type { ProxyChange } from './proxy-change';
import { testConnectionCommand } from './test-connection';

type AddApi = Pick<
  VscodeApi,
  'ProgressLocation' | 'QuickInputButtons' | 'commands' | 'env' | 'l10n' | 'window' | 'workspace'
>;

type AddManager = Pick<
  ProxyManager,
  'getEntryNames' | 'hasConfiguration' | 'readProxySettings' | 'settingsHoldProxy'
>;

const ACTION_CONTINUE: NotificationAction = { id: 'continue', title: 'Continue Without Them' };
const ACTION_OPEN_SETTINGS: NotificationAction = { id: 'openSettings', title: 'Open Settings' };
const ACTION_TURN_ON: NotificationAction = { id: 'turnOn', title: 'Turn On' };
const ACTION_NOT_NOW: NotificationAction = { id: 'notNow', title: 'Not Now' };
const ACTION_TEST: NotificationAction = { id: 'test', title: 'Test Connection' };

type Start = Omit<Profile, 'name' | 'proxyUrl'> & { proxyUrl?: string; unheld: string[] };

// Two steps, the proxy URL and then the name. A new profile starts with strict SSL on and an
// empty bypass list, unless setup starts from the proxy VS Code already uses.
export async function addProfileCommand(
  vscodeApi: AddApi,
  proxyManager: AddManager,
  notificationService: Notifier,
  change: ProxyChange,
  options: { fromCurrentSettings?: boolean } = {}
): Promise<void> {
  const start = options.fromCurrentSettings
    ? valuesFromSettings(proxyManager.readProxySettings())
    : startingValues(proxyManager);
  if (options.fromCurrentSettings && start.unheld.length > 0) {
    // Saving the settings as a profile that does not match them would not end the drift.
    const choice = await notificationService.showWarning(
      `A profile cannot hold what VS Code's proxy settings hold: ${start.unheld.join(', ')}.`,
      ACTION_OPEN_SETTINGS
    );
    if (choice === ACTION_OPEN_SETTINGS.id) {
      await vscodeApi.commands.executeCommand('workbench.action.openApplicationSettingsJson');
    }
    return;
  }
  if (start.unheld.length > 0) {
    const choice = await notificationService.showWarning(
      `VS Code's proxy settings hold what a profile cannot: ${start.unheld.join(', ')}.`,
      ACTION_CONTINUE,
      ACTION_OPEN_SETTINGS
    );
    if (choice === ACTION_OPEN_SETTINGS.id) {
      // The http.* settings are application-scoped, like proxyToggler.profiles.
      await vscodeApi.commands.executeCommand('workbench.action.openApplicationSettingsJson');
      return;
    }
    if (choice !== ACTION_CONTINUE.id) {
      return;
    }
  }

  const saved = await askAndSave(vscodeApi, proxyManager, change, start);
  if (!saved) {
    return;
  }

  const { profile } = saved;
  if (saved.isOn) {
    const tested = await notificationService.showSuccess(
      `Saved ${profile.name}. It matches VS Code's proxy settings, so it is on.`,
      ACTION_TEST
    );
    if (tested === ACTION_TEST.id) {
      await testConnectionCommand(vscodeApi, notificationService, profile);
    }
    return;
  }

  const replaces =
    start.unheld.length > 0
      ? " It does not hold all of VS Code's proxy settings, so turning it on replaces them."
      : '';
  const choice = await notificationService.showSuccess(
    `Saved ${profile.name}.${replaces} Turn it on now?`,
    ACTION_TURN_ON,
    ACTION_TEST,
    ACTION_NOT_NOW
  );
  if (choice === ACTION_TEST.id) {
    await testConnectionCommand(vscodeApi, notificationService, profile);
    return;
  }
  if (choice === ACTION_TURN_ON.id) {
    await change((manager) => manager.switchTo(profile.name));
  }
}

// With no profile yet and a proxy in VS Code's settings, setup starts from those settings.
function startingValues(proxyManager: AddManager): Start {
  const fresh: Start = { strictSSL: true, bypassList: [], unheld: [] };
  if (proxyManager.hasConfiguration()) {
    return fresh;
  }

  return proxyManager.settingsHoldProxy()
    ? valuesFromSettings(proxyManager.readProxySettings())
    : fresh;
}

// Asks for the profile and saves it. When another window takes the name meanwhile, the name is
// asked again, with the proxy URL kept. Undefined when the user cancels or the save failed.
async function askAndSave(
  vscodeApi: AddApi,
  proxyManager: AddManager,
  change: ProxyChange,
  start: Start
): Promise<Saved | undefined> {
  let answers = await askForProfile(vscodeApi, proxyManager.getEntryNames(), start.proxyUrl);
  while (answers) {
    const profile: Profile = {
      ...answers,
      strictSSL: start.strictSSL,
      bypassList: start.bypassList
    };
    const result = await change((manager) => manager.addProfile(profile));
    if (result.kind === 'saved') {
      return result;
    }
    // A failed write, which `change` has already reported.
    if (result.kind === 'writeFailed') {
      return undefined;
    }
    answers = await askForProfile(
      vscodeApi,
      proxyManager.getEntryNames(),
      answers.proxyUrl,
      result.name
    );
  }
  return undefined;
}

// Given a name that was refused, it opens at the name step with that name, and the proxy URL as it
// was.
async function askForProfile(
  vscodeApi: AddApi,
  takenNames: readonly string[],
  proxyUrl = '',
  refusedName?: string
): Promise<Pick<Profile, 'name' | 'proxyUrl'> | undefined> {
  const { l10n } = vscodeApi;
  const title = l10n.t('Add Profile');
  let url = proxyUrl;
  let name = refusedName;
  let suggestion: string | undefined;
  let askUrl = refusedName === undefined;

  for (;;) {
    if (askUrl) {
      const urlAnswer = await askText(vscodeApi, {
        title,
        step: 1,
        totalSteps: 2,
        prompt: l10n.t('The proxy URL, such as http://proxy.example.com:8080'),
        value: url,
        canGoBack: false,
        validate: (value) => problemWith(() => validateProxyUrl(value))
      });
      if (typeof urlAnswer !== 'string') {
        return undefined;
      }
      url = urlAnswer.trim();
    }
    // Back from the name step asks for the proxy URL again.
    askUrl = true;

    // A name the user has not changed follows the host.
    const nextSuggestion = defaultProfileName(new URL(url).hostname, takenNames);
    if (name === undefined || name === suggestion) {
      name = nextSuggestion;
    }
    suggestion = nextSuggestion;

    const nameAnswer = await askText(vscodeApi, {
      title,
      step: 2,
      totalSteps: 2,
      prompt: l10n.t('A name for the profile'),
      value: name,
      canGoBack: true,
      validate: (value) => validateProfileName(value, takenNames)
    });
    if (nameAnswer === BACK) {
      continue;
    }
    if (nameAnswer === undefined) {
      return undefined;
    }
    return { proxyUrl: url, name: nameAnswer.trim() };
  }
}
