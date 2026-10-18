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
  /** Stable identifier returned when the action is selected. */
  id: string;
  /** User-visible action label (localized at display time). */
  title: string;
};

export class NotificationService {
  /**
   * @param vscodeApi VS Code API surface used for notifications and localization.
   * @example
   * ```ts
   * const notifications = new NotificationService(vscode);
   * ```
   */
  constructor(private readonly vscodeApi: VscodeApi) {}

  /**
   * Shows an informational notification.
   *
   * @param message Message to display (localized via `vscode.l10n`).
   * @param actions Optional actions to display as buttons.
   * @returns The selected action id, or `undefined` if dismissed.
   * @throws {Error} If the VS Code notification API rejects.
   * @example
   * ```ts
   * const choice = await notifications.showSuccess('Proxy enabled', { id: 'disable', title: 'Disable Proxy' });
   * ```
   */
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

  /**
   * Shows a warning notification.
   *
   * @param message Message to display (localized via `vscode.l10n`).
   * @param actions Optional actions to display as buttons.
   * @returns The selected action id, or `undefined` if dismissed.
   * @throws {Error} If the VS Code notification API rejects.
   * @example
   * ```ts
   * await notifications.showWarning('No configuration found.', { id: 'configure', title: 'Configure Now' });
   * ```
   */
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

  /**
   * Shows an error notification.
   *
   * @param message Message to display (localized via `vscode.l10n`).
   * @param actions Optional actions to display as buttons.
   * @returns The selected action id, or `undefined` if dismissed.
   * @throws {Error} If the VS Code notification API rejects.
   * @example
   * ```ts
   * await notifications.showError('Failed to enable proxy.', { id: 'settings', title: 'Open Settings' });
   * ```
   */
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
