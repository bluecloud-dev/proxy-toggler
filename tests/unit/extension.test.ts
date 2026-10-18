import { strict as assert } from 'node:assert';

import type {
  ConfigurationTarget,
  Disposable,
  ExtensionContext,
  StatusBarAlignment,
  StatusBarItem
} from 'vscode';

import {
  COMMAND_CONFIGURE,
  COMMAND_DISABLE,
  COMMAND_ENABLE,
  COMMAND_TOGGLE,
  activate
} from '../../src/extension';

describe('extension command registration', () => {
  it('registers placeholder commands and pushes disposables', async () => {
    const run = async (options: { mode: 'direct' | 'importer' | 'default' }): Promise<void> => {
      const registerCommandCalls: string[] = [];
      const infoMessages: string[] = [];
      const errorMessages: string[] = [];
      const warningMessages: string[] = [];
      const handlers = new Map<string, () => Promise<void> | void>();
      let importCalled = false;

      const workspaceStorage = new Map<string, Map<string, unknown>>();

      const vscodeApi = {
        ConfigurationTarget: {
          Global: 1 as unknown as ConfigurationTarget
        },
        StatusBarAlignment: {
          Right: 2 as unknown as StatusBarAlignment
        },
        commands: {
          registerCommand: (commandId: string, handler: () => Promise<void> | void): Disposable => {
            registerCommandCalls.push(commandId);
            handlers.set(commandId, handler);
            return { dispose: () => {} };
          },
          executeCommand: async (): Promise<unknown> => undefined
        },
        l10n: {
          t: (message: string): string => message
        },
        workspace: {
          getConfiguration: (section: string) => {
            const sectionStorage = workspaceStorage.get(section) ?? new Map<string, unknown>();
            workspaceStorage.set(section, sectionStorage);

            return {
              get: <T>(key: string, defaultValue?: T): T => {
                if (sectionStorage.has(key)) {
                  return sectionStorage.get(key) as T;
                }
                return defaultValue as T;
              },
              inspect: <T>(key: string): { defaultValue?: T; globalValue?: T } => ({
                defaultValue: undefined,
                globalValue: sectionStorage.get(key) as T
              }),
              update: async (key: string, value: unknown): Promise<void> => {
                sectionStorage.set(key, value);
              }
            };
          }
        },
        window: {
          showInformationMessage: async (message: string): Promise<string | undefined> => {
            infoMessages.push(message);
            return undefined;
          },
          showErrorMessage: async (message: string): Promise<string | undefined> => {
            errorMessages.push(message);
            return undefined;
          },
          showWarningMessage: async (message: string): Promise<string | undefined> => {
            warningMessages.push(message);
            return undefined;
          },
          showInputBox: async (): Promise<string | undefined> => undefined,
          showQuickPick: async (): Promise<undefined> => undefined,
          createStatusBarItem: (): StatusBarItem =>
            ({
              text: '',
              show: () => {},
              dispose: () => {}
            }) as unknown as StatusBarItem
        }
      };

      const secretStore = new Map<string, string>();
      const secrets = {
        get: async (key: string): Promise<string | undefined> => secretStore.get(key),
        store: async (key: string, value: string): Promise<void> => {
          secretStore.set(key, value);
        },
        delete: async (key: string): Promise<void> => {
          secretStore.delete(key);
        }
      };

      const stateStore = new Map<string, unknown>();
      const globalState = {
        get: <T>(key: string): T | undefined => stateStore.get(key) as T | undefined,
        update: async (key: string, value: unknown): Promise<void> => {
          stateStore.set(key, value);
        }
      };

      const context = { subscriptions: [], secrets, globalState } as unknown as ExtensionContext;

      if (options.mode === 'direct') {
        activate(context, vscodeApi);
      } else if (options.mode === 'importer') {
        activate(context, undefined, () => {
          importCalled = true;
          return vscodeApi;
        });
        assert.equal(importCalled, true);
      } else {
        const Module = require('module') as unknown as {
          _load: (request: string, parent: unknown, isMain: boolean) => unknown;
        };

        const originalLoad = Module._load;
        Module._load = (request: string, parent: unknown, isMain: boolean): unknown => {
          if (request === 'vscode') {
            importCalled = true;
            return vscodeApi;
          }
          return originalLoad.call(Module, request, parent, isMain);
        };

        try {
          activate(context);
        } finally {
          Module._load = originalLoad;
        }

        assert.equal(importCalled, true);
      }

      assert.deepEqual(registerCommandCalls, [
        COMMAND_CONFIGURE,
        COMMAND_ENABLE,
        COMMAND_DISABLE,
        COMMAND_TOGGLE
      ]);
      assert.equal(context.subscriptions.length, 7);

      await handlers.get(COMMAND_CONFIGURE)?.();
      await handlers.get(COMMAND_ENABLE)?.();
      await handlers.get(COMMAND_DISABLE)?.();
      await handlers.get(COMMAND_TOGGLE)?.();

      assert.equal(errorMessages.length, 0);
      assert.equal(infoMessages.length, 1);
      assert.equal(warningMessages.length, 2);
    };

    await run({ mode: 'direct' });
    await run({ mode: 'importer' });
    await run({ mode: 'default' });
  });

  it('syncs toggle state on activation when drift detected', async () => {
    const warningMessages: string[] = [];
    let synced = false;

    const workspaceStorage = new Map<string, Map<string, unknown>>();
    workspaceStorage.set(
      'http',
      new Map<string, unknown>([
        ['proxy', 'http://proxy.example.com:8080'],
        ['proxyStrictSSL', true],
        ['noProxy', 'localhost']
      ])
    );

    const stateStore = new Map<string, unknown>();
    stateStore.set('proxyToggler.savedProxy', {
      proxyUrl: 'http://proxy.example.com:8080',
      strictSSL: true,
      noProxy: 'localhost'
    });
    stateStore.set('proxyToggler.state', { isEnabled: false, hasConfiguration: true });

    let resolveSynced: (() => void) | undefined;
    const syncedPromise = new Promise<void>((resolve) => {
      resolveSynced = resolve;
    });

    const vscodeApi = {
      ConfigurationTarget: {
        Global: 1 as unknown as ConfigurationTarget
      },
      StatusBarAlignment: {
        Right: 2 as unknown as StatusBarAlignment
      },
      commands: {
        registerCommand: (): Disposable => ({ dispose: () => {} }),
        executeCommand: async (): Promise<unknown> => undefined
      },
      l10n: {
        t: (message: string): string => message
      },
      workspace: {
        getConfiguration: (section: string) => {
          const sectionStorage = workspaceStorage.get(section) ?? new Map<string, unknown>();
          workspaceStorage.set(section, sectionStorage);

          return {
            get: <T>(key: string, defaultValue?: T): T => {
              if (sectionStorage.has(key)) {
                return sectionStorage.get(key) as T;
              }
              return defaultValue as T;
            },
            inspect: <T>(key: string): { defaultValue?: T; globalValue?: T } => ({
              defaultValue: undefined,
              globalValue: sectionStorage.get(key) as T
            }),
            update: async (key: string, value: unknown): Promise<void> => {
              sectionStorage.set(key, value);
            }
          };
        }
      },
      window: {
        showInformationMessage: async (): Promise<string | undefined> => undefined,
        showErrorMessage: async (): Promise<string | undefined> => undefined,
        showWarningMessage: async (
          message: string,
          ...items: string[]
        ): Promise<string | undefined> => {
          warningMessages.push(`${message}:${items.join(',')}`);
          return 'Sync';
        },
        showInputBox: async (): Promise<string | undefined> => undefined,
        showQuickPick: async (): Promise<undefined> => undefined,
        createStatusBarItem: (): StatusBarItem =>
          ({
            text: '',
            show: () => {},
            dispose: () => {}
          }) as unknown as StatusBarItem
      }
    };

    const secrets = {
      get: async (): Promise<string | undefined> => undefined,
      store: async (): Promise<void> => undefined,
      delete: async (): Promise<void> => undefined
    };

    const globalState = {
      get: <T>(key: string): T | undefined => stateStore.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        stateStore.set(key, value);
        if (key === 'proxyToggler.state') {
          const next = value as { isEnabled?: boolean };
          if (next.isEnabled === true) {
            synced = true;
            resolveSynced?.();
          }
        }
      }
    };

    const context = { subscriptions: [], secrets, globalState } as unknown as ExtensionContext;

    activate(context, vscodeApi);

    await syncedPromise;

    assert.equal(warningMessages.length, 1);
    assert.equal(synced, true);
  });

  it('does not prompt drift sync when no saved configuration exists', async () => {
    const warningMessages: string[] = [];

    const workspaceStorage = new Map<string, Map<string, unknown>>();
    workspaceStorage.set(
      'http',
      new Map<string, unknown>([
        ['proxy', 'http://proxy.example.com:8080'],
        ['proxyStrictSSL', true],
        ['noProxy', 'localhost']
      ])
    );

    const vscodeApi = {
      ConfigurationTarget: {
        Global: 1 as unknown as ConfigurationTarget
      },
      StatusBarAlignment: {
        Right: 2 as unknown as StatusBarAlignment
      },
      commands: {
        registerCommand: (): Disposable => ({ dispose: () => {} }),
        executeCommand: async (): Promise<unknown> => undefined
      },
      l10n: {
        t: (message: string): string => message
      },
      workspace: {
        getConfiguration: (section: string) => {
          const sectionStorage = workspaceStorage.get(section) ?? new Map<string, unknown>();
          workspaceStorage.set(section, sectionStorage);

          return {
            get: <T>(key: string, defaultValue?: T): T => {
              if (sectionStorage.has(key)) {
                return sectionStorage.get(key) as T;
              }
              return defaultValue as T;
            },
            inspect: <T>(key: string): { defaultValue?: T; globalValue?: T } => ({
              defaultValue: undefined,
              globalValue: sectionStorage.get(key) as T
            }),
            update: async (key: string, value: unknown): Promise<void> => {
              sectionStorage.set(key, value);
            }
          };
        }
      },
      window: {
        showInformationMessage: async (): Promise<string | undefined> => undefined,
        showErrorMessage: async (): Promise<string | undefined> => undefined,
        showWarningMessage: async (message: string): Promise<string | undefined> => {
          warningMessages.push(message);
          return undefined;
        },
        showInputBox: async (): Promise<string | undefined> => undefined,
        showQuickPick: async (): Promise<undefined> => undefined,
        createStatusBarItem: (): StatusBarItem =>
          ({
            text: '',
            show: () => {},
            dispose: () => {}
          }) as unknown as StatusBarItem
      }
    };

    const secrets = {
      get: async (): Promise<string | undefined> => undefined,
      store: async (): Promise<void> => undefined,
      delete: async (): Promise<void> => undefined
    };

    const stateStore = new Map<string, unknown>();
    const globalState = {
      get: <T>(key: string): T | undefined => stateStore.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        stateStore.set(key, value);
      }
    };

    const context = { subscriptions: [], secrets, globalState } as unknown as ExtensionContext;

    activate(context, vscodeApi);

    assert.equal(warningMessages.length, 0);
  });

  it('does not prompt drift sync when state matches VS Code settings', async () => {
    const warningMessages: string[] = [];

    const workspaceStorage = new Map<string, Map<string, unknown>>();
    workspaceStorage.set(
      'http',
      new Map<string, unknown>([
        ['proxy', 'http://proxy.example.com:8080'],
        ['proxyStrictSSL', true],
        ['noProxy', 'localhost']
      ])
    );

    const stateStore = new Map<string, unknown>();
    stateStore.set('proxyToggler.savedProxy', {
      proxyUrl: 'http://proxy.example.com:8080',
      strictSSL: true,
      noProxy: 'localhost'
    });
    stateStore.set('proxyToggler.state', { isEnabled: true, hasConfiguration: true });

    const vscodeApi = {
      ConfigurationTarget: {
        Global: 1 as unknown as ConfigurationTarget
      },
      StatusBarAlignment: {
        Right: 2 as unknown as StatusBarAlignment
      },
      commands: {
        registerCommand: (): Disposable => ({ dispose: () => {} }),
        executeCommand: async (): Promise<unknown> => undefined
      },
      l10n: {
        t: (message: string): string => message
      },
      workspace: {
        getConfiguration: (section: string) => {
          const sectionStorage = workspaceStorage.get(section) ?? new Map<string, unknown>();
          workspaceStorage.set(section, sectionStorage);

          return {
            get: <T>(key: string, defaultValue?: T): T => {
              if (sectionStorage.has(key)) {
                return sectionStorage.get(key) as T;
              }
              return defaultValue as T;
            },
            inspect: <T>(key: string): { defaultValue?: T; globalValue?: T } => ({
              defaultValue: undefined,
              globalValue: sectionStorage.get(key) as T
            }),
            update: async (key: string, value: unknown): Promise<void> => {
              sectionStorage.set(key, value);
            }
          };
        }
      },
      window: {
        showInformationMessage: async (): Promise<string | undefined> => undefined,
        showErrorMessage: async (): Promise<string | undefined> => undefined,
        showWarningMessage: async (message: string): Promise<string | undefined> => {
          warningMessages.push(message);
          return undefined;
        },
        showInputBox: async (): Promise<string | undefined> => undefined,
        showQuickPick: async (): Promise<undefined> => undefined,
        createStatusBarItem: (): StatusBarItem =>
          ({
            text: '',
            show: () => {},
            dispose: () => {}
          }) as unknown as StatusBarItem
      }
    };

    const secrets = {
      get: async (): Promise<string | undefined> => undefined,
      store: async (): Promise<void> => undefined,
      delete: async (): Promise<void> => undefined
    };

    const globalState = {
      get: <T>(key: string): T | undefined => stateStore.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        stateStore.set(key, value);
      }
    };

    const context = { subscriptions: [], secrets, globalState } as unknown as ExtensionContext;

    activate(context, vscodeApi);

    assert.equal(warningMessages.length, 0);
  });

  it('writes http.noProxy as an array when VS Code schema default is array', async () => {
    const handlers = new Map<string, () => Promise<void> | void>();
    const workspaceStorage = new Map<string, Map<string, unknown>>();

    const vscodeApi = {
      ConfigurationTarget: {
        Global: 1 as unknown as ConfigurationTarget
      },
      StatusBarAlignment: {
        Right: 2 as unknown as StatusBarAlignment
      },
      commands: {
        registerCommand: (commandId: string, handler: () => Promise<void> | void): Disposable => {
          handlers.set(commandId, handler);
          return { dispose: () => {} };
        },
        executeCommand: async (): Promise<unknown> => undefined
      },
      l10n: {
        t: (message: string): string => message
      },
      workspace: {
        getConfiguration: (section: string) => {
          const sectionStorage = workspaceStorage.get(section) ?? new Map<string, unknown>();
          workspaceStorage.set(section, sectionStorage);

          return {
            get: <T>(key: string, defaultValue?: T): T => {
              if (sectionStorage.has(key)) {
                return sectionStorage.get(key) as T;
              }
              return defaultValue as T;
            },
            inspect: <T>(key: string): { defaultValue?: T; globalValue?: T } => ({
              defaultValue: key === 'noProxy' ? ([] as unknown as T) : undefined,
              globalValue: sectionStorage.get(key) as T
            }),
            update: async (key: string, value: unknown): Promise<void> => {
              sectionStorage.set(key, value);
            }
          };
        }
      },
      window: {
        showInformationMessage: async (): Promise<string | undefined> => undefined,
        showErrorMessage: async (): Promise<string | undefined> => undefined,
        showWarningMessage: async (): Promise<string | undefined> => undefined,
        showInputBox: async (): Promise<string | undefined> => undefined,
        showQuickPick: async (): Promise<undefined> => undefined,
        createStatusBarItem: (): StatusBarItem =>
          ({
            text: '',
            show: () => {},
            dispose: () => {}
          }) as unknown as StatusBarItem
      }
    };

    const secrets = {
      get: async (): Promise<string | undefined> => undefined,
      store: async (): Promise<void> => undefined,
      delete: async (): Promise<void> => undefined
    };

    const stateStore = new Map<string, unknown>();
    stateStore.set('proxyToggler.savedProxy', {
      proxyUrl: 'http://proxy.example.com:8080',
      strictSSL: true,
      noProxy: 'localhost,127.0.0.1'
    });
    stateStore.set('proxyToggler.state', { isEnabled: false, hasConfiguration: true });

    const globalState = {
      get: <T>(key: string): T | undefined => stateStore.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        stateStore.set(key, value);
      }
    };

    const context = { subscriptions: [], secrets, globalState } as unknown as ExtensionContext;

    activate(context, vscodeApi);

    await handlers.get(COMMAND_ENABLE)?.();

    const httpConfig = workspaceStorage.get('http');
    assert.ok(httpConfig);
    assert.deepEqual(httpConfig?.get('noProxy'), ['localhost', '127.0.0.1']);
  });

  it('does not prompt drift sync when http.noProxy is an array and matches saved config', async () => {
    const warningMessages: string[] = [];

    const workspaceStorage = new Map<string, Map<string, unknown>>();
    workspaceStorage.set(
      'http',
      new Map<string, unknown>([
        ['proxy', 'http://proxy.example.com:8080'],
        ['proxyStrictSSL', true],
        ['noProxy', ['localhost']]
      ])
    );

    const stateStore = new Map<string, unknown>();
    stateStore.set('proxyToggler.savedProxy', {
      proxyUrl: 'http://proxy.example.com:8080',
      strictSSL: true,
      noProxy: 'localhost'
    });
    stateStore.set('proxyToggler.state', { isEnabled: true, hasConfiguration: true });

    const vscodeApi = {
      ConfigurationTarget: {
        Global: 1 as unknown as ConfigurationTarget
      },
      StatusBarAlignment: {
        Right: 2 as unknown as StatusBarAlignment
      },
      commands: {
        registerCommand: (): Disposable => ({ dispose: () => {} }),
        executeCommand: async (): Promise<unknown> => undefined
      },
      l10n: {
        t: (message: string): string => message
      },
      workspace: {
        getConfiguration: (section: string) => {
          const sectionStorage = workspaceStorage.get(section) ?? new Map<string, unknown>();
          workspaceStorage.set(section, sectionStorage);

          return {
            get: <T>(key: string, defaultValue?: T): T => {
              if (sectionStorage.has(key)) {
                return sectionStorage.get(key) as T;
              }
              return defaultValue as T;
            },
            inspect: <T>(key: string): { defaultValue?: T; globalValue?: T } => ({
              defaultValue: undefined,
              globalValue: sectionStorage.get(key) as T
            }),
            update: async (key: string, value: unknown): Promise<void> => {
              sectionStorage.set(key, value);
            }
          };
        }
      },
      window: {
        showInformationMessage: async (): Promise<string | undefined> => undefined,
        showErrorMessage: async (): Promise<string | undefined> => undefined,
        showWarningMessage: async (message: string): Promise<string | undefined> => {
          warningMessages.push(message);
          return undefined;
        },
        showInputBox: async (): Promise<string | undefined> => undefined,
        showQuickPick: async (): Promise<undefined> => undefined,
        createStatusBarItem: (): StatusBarItem =>
          ({
            text: '',
            show: () => {},
            dispose: () => {}
          }) as unknown as StatusBarItem
      }
    };

    const secrets = {
      get: async (): Promise<string | undefined> => undefined,
      store: async (): Promise<void> => undefined,
      delete: async (): Promise<void> => undefined
    };

    const globalState = {
      get: <T>(key: string): T | undefined => stateStore.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        stateStore.set(key, value);
      }
    };

    const context = { subscriptions: [], secrets, globalState } as unknown as ExtensionContext;

    activate(context, vscodeApi);

    assert.equal(warningMessages.length, 0);
  });
});
