type L10n = {
  t: (message: string, ...args: (string | number)[]) => string;
};

type WindowApi = {
  showInformationMessage: (message: string, ...items: string[]) => PromiseLike<string | undefined>;
  showWarningMessage: (message: string, ...items: string[]) => PromiseLike<string | undefined>;
  showErrorMessage: (message: string, ...items: string[]) => PromiseLike<string | undefined>;
};

type VscodeApi = {
  l10n: L10n;
  window: WindowApi;
};

export type NotificationAction = {
  id: string;
  // Untranslated; localized when shown, while `id` stays stable for callers.
  title: string;
};

export class NotificationService {
  constructor(private readonly vscodeApi: VscodeApi) {}

  async showSuccess(
    message: string,
    ...actions: NotificationAction[]
  ): Promise<string | undefined> {
    const localizedActions = actions.map((action) => ({
      id: action.id,
      title: this.vscodeApi.l10n.t(action.title)
    }));
    const actionTitles = localizedActions.map((action) => action.title);
    const selection = await this.vscodeApi.window.showInformationMessage(
      this.vscodeApi.l10n.t(message),
      ...actionTitles
    );

    return localizedActions.find((action) => action.title === selection)?.id;
  }

  async showWarning(
    message: string,
    ...actions: NotificationAction[]
  ): Promise<string | undefined> {
    const localizedActions = actions.map((action) => ({
      id: action.id,
      title: this.vscodeApi.l10n.t(action.title)
    }));
    const actionTitles = localizedActions.map((action) => action.title);
    const selection = await this.vscodeApi.window.showWarningMessage(
      this.vscodeApi.l10n.t(message),
      ...actionTitles
    );

    return localizedActions.find((action) => action.title === selection)?.id;
  }

  async showError(message: string, ...actions: NotificationAction[]): Promise<string | undefined> {
    const localizedActions = actions.map((action) => ({
      id: action.id,
      title: this.vscodeApi.l10n.t(action.title)
    }));
    const actionTitles = localizedActions.map((action) => action.title);
    const selection = await this.vscodeApi.window.showErrorMessage(
      this.vscodeApi.l10n.t(message),
      ...actionTitles
    );

    return localizedActions.find((action) => action.title === selection)?.id;
  }
}
