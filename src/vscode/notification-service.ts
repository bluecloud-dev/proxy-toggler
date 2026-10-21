import type { Logger, VscodeApi } from './api';
import { runInBackground } from './error-reporting';

export type NotificationAction = {
  id: string;
  // Untranslated; localized when shown, while `id` stays stable for callers.
  title: string;
};

type MessageMethod = 'showInformationMessage' | 'showWarningMessage' | 'showErrorMessage';

const MESSAGE_METHODS = {
  success: 'showInformationMessage',
  warning: 'showWarningMessage',
  error: 'showErrorMessage'
} as const satisfies Record<string, MessageMethod>;

export class NotificationService {
  constructor(
    private readonly vscodeApi: Pick<VscodeApi, 'l10n' | 'window'>,
    // Where a message that could not be shown is logged.
    private readonly logger: Logger
  ) {}

  // Shows a message without waiting for the user to close it, so the caller goes on at once.
  inform(kind: keyof typeof MESSAGE_METHODS, message: string): void {
    runInBackground(this.logger, 'Notification', async () => {
      await this.show(MESSAGE_METHODS[kind], message, []);
    });
  }

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

export type Notifier = Pick<
  NotificationService,
  'inform' | 'showSuccess' | 'showWarning' | 'showError'
>;
