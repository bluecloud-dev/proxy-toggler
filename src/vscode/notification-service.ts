import type { VscodeApi } from './api';

export type NotificationAction = {
  id: string;
  // Untranslated; localized when shown, while `id` stays stable for callers.
  title: string;
};

type MessageMethod = 'showInformationMessage' | 'showWarningMessage' | 'showErrorMessage';

export class NotificationService {
  constructor(private readonly vscodeApi: Pick<VscodeApi, 'l10n' | 'window'>) {}

  showSuccess(message: string, ...actions: NotificationAction[]): Promise<string | undefined> {
    return this.show('showInformationMessage', message, actions);
  }

  showWarning(message: string, ...actions: NotificationAction[]): Promise<string | undefined> {
    return this.show('showWarningMessage', message, actions);
  }

  showError(message: string, ...actions: NotificationAction[]): Promise<string | undefined> {
    return this.show('showErrorMessage', message, actions);
  }

  private async show(
    method: MessageMethod,
    message: string,
    actions: NotificationAction[]
  ): Promise<string | undefined> {
    const { l10n, window } = this.vscodeApi;
    const titles = actions.map((action) => l10n.t(action.title));
    const selection = await window[method](l10n.t(message), ...titles);

    return actions.find((_, index) => titles[index] === selection)?.id;
  }
}

export type Notifier = Pick<NotificationService, 'showSuccess' | 'showWarning' | 'showError'>;
