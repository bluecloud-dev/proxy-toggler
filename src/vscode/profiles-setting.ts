import type { ProfilesSetting } from '../core/profiles';
import type { VscodeApi, WorkspaceConfiguration } from './api';

// proxyToggler.profiles is application-scoped, so VS Code reads it only from user settings, shared
// by every VS Code Profile and never from workspace files (ADR 0002).
export function createProfilesSetting(
  vscodeApi: Pick<VscodeApi, 'ConfigurationTarget' | 'workspace'>
): ProfilesSetting {
  const configuration = (): WorkspaceConfiguration =>
    vscodeApi.workspace.getConfiguration('proxyToggler');

  return {
    read: () => configuration().get<unknown>('profiles'),
    write: async (entries) => {
      await configuration().update('profiles', entries, vscodeApi.ConfigurationTarget.Global);
    }
  };
}
