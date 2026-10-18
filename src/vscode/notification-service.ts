import type { VscodeApi } from './api';

export type NotificationAction = {
  id: string;
  // Untranslated; localized when shown, while `id` stays stable for callers.
  title: string;
};

export class NotificationService {
  constructor(private readonly vscodeApi: Pick<VscodeApi, 'l10n' | 'window'>) {}

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
