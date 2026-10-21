import type * as vscode from 'vscode';

import type { VscodeApi } from './api';

// Shows a single-choice QuickPick and settles with the accepted item, or undefined when the user
// closes it. Unlike showQuickPick, it can open with an item focused.
export function pickOne<T extends vscode.QuickPickItem>(
  vscodeApi: Pick<VscodeApi, 'window'>,
  options: { items: readonly T[]; activeItem?: T; title?: string; placeholder?: string }
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const quickPick = vscodeApi.window.createQuickPick<T>();
    quickPick.title = options.title;
    quickPick.placeholder = options.placeholder;
    quickPick.matchOnDescription = true;
    quickPick.items = options.items;
    if (options.activeItem) {
      quickPick.activeItems = [options.activeItem];
    }

    let accepted: T | undefined;
    quickPick.onDidAccept(() => {
      accepted = quickPick.selectedItems[0] ?? quickPick.activeItems[0];
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve(accepted);
    });
    quickPick.show();
  });
}
