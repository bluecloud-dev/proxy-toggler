import type { VscodeApi } from './api';

// Resolves once a setting has gone `quietMs` without changing, so that writes other windows made
// at the same time have landed.
export function whenSettled(
  vscodeApi: Pick<VscodeApi, 'workspace'>,
  section: string,
  quietMs: number
): Promise<void> {
  return new Promise((resolve) => {
    const settle = (): void => {
      listener.dispose();
      resolve();
    };
    // Unreferenced: a pending wait never keeps a process alive on its own.
    const wait = (): NodeJS.Timeout => setTimeout(settle, quietMs).unref();
    let timer = wait();
    const listener = vscodeApi.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(section)) {
        clearTimeout(timer);
        timer = wait();
      }
    });
  });
}
