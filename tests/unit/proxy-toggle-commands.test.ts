import { strict as assert } from 'node:assert';

import { disableProxyCommand } from '../../src/commands/disable-proxy';
import { enableProxyCommand } from '../../src/commands/enable-proxy';
import { toggleProxyCommand } from '../../src/commands/toggle-proxy';
import { KeychainError, KeychainErrorReason } from '../../src/core/keychain-service';
import { ConfigurationError } from '../../src/core/proxy-manager';
import type { NotificationAction } from '../../src/vscode/notification-service';

type ProxyManagerStub = {
  hasConfiguration: () => boolean;
  getState: () => { isEnabled: boolean; hasConfiguration: boolean };
  enableProxy: () => Promise<void>;
  disableProxy: () => Promise<void>;
  toggleProxy: () => Promise<boolean>;
};

describe('US2 command handlers', () => {
  it('enableProxyCommand prompts to configure when missing configuration', async () => {
    const executed: string[] = [];
    const warningMessages: Array<{ message: string; actions: NotificationAction[] }> = [];

    const vscodeApi = createVscodeApiStub({
      executeCommand: async (command) => {
        executed.push(command);
      }
    });

    const proxyManager = createProxyManagerStub({ hasConfiguration: false });
    const notificationService = createNotificationServiceStub({
      onWarning: async (message, actions) => {
        warningMessages.push({ message, actions });
        return 'configure';
      }
    });

    await enableProxyCommand(vscodeApi, proxyManager, notificationService, async () => {});

    assert.equal(warningMessages.length, 1);
    assert.deepEqual(executed, ['proxyToggler.configure']);
  });

  it('enableProxyCommand enables and shows success message', async () => {
    const informationMessages: string[] = [];
    let refreshed = 0;
    const proxyManager = createProxyManagerStub({ hasConfiguration: true });

    const vscodeApi = createVscodeApiStub();
    const notificationService = createNotificationServiceStub({
      onSuccess: async (message) => {
        informationMessages.push(message);
      }
    });

    await enableProxyCommand(vscodeApi, proxyManager, notificationService, async () => {
      refreshed += 1;
    });

    assert.equal(informationMessages.length, 1);
    assert.match(informationMessages[0] ?? '', /enabled/i);
    assert.equal(proxyManager.enableCalls, 1);
    assert.equal(refreshed, 1);
  });

  it('disableProxyCommand disables and shows success message', async () => {
    const informationMessages: string[] = [];
    let refreshed = 0;
    const proxyManager = createProxyManagerStub({ hasConfiguration: false });
    const notificationService = createNotificationServiceStub({
      onSuccess: async (message) => {
        informationMessages.push(message);
      }
    });

    await disableProxyCommand(
      createVscodeApiStub(),
      proxyManager,
      notificationService,
      async () => {
        refreshed += 1;
      }
    );

    assert.equal(proxyManager.disableCalls, 1);
    assert.equal(informationMessages.length, 1);
    assert.match(informationMessages[0] ?? '', /disabled/i);
    assert.equal(refreshed, 1);
  });

  it('toggleProxyCommand prompts for confirmation when enabled', async () => {
    const informationMessages: string[] = [];
    const warningMessages: Array<{ message: string; actions: NotificationAction[] }> = [];
    const proxyManager = createProxyManagerStub({ hasConfiguration: true, isEnabled: true });

    const vscodeApi = createVscodeApiStub({
      confirmBeforeToggle: true,
      executeCommand: async (): Promise<unknown> => undefined
    });
    const notificationService = createNotificationServiceStub({
      onWarning: async (message, actions) => {
        warningMessages.push({ message, actions });
        return 'cancel';
      },
      onSuccess: async (message) => {
        informationMessages.push(message);
      }
    });

    await toggleProxyCommand(vscodeApi, proxyManager, notificationService, async () => {});

    assert.equal(warningMessages.length, 1);
    assert.equal(proxyManager.toggleCalls, 0);
    assert.equal(informationMessages.length, 0);
  });

  it('toggleProxyCommand toggles when confirmation accepted', async () => {
    const informationMessages: string[] = [];
    const proxyManager = createProxyManagerStub({
      hasConfiguration: true,
      isEnabled: false,
      toggleResult: true
    });

    const vscodeApi = createVscodeApiStub({
      confirmBeforeToggle: true,
      executeCommand: async (): Promise<unknown> => undefined
    });
    const notificationService = createNotificationServiceStub({
      onWarning: async (_message, actions) => actions[0]?.id,
      onSuccess: async (message) => {
        informationMessages.push(message);
      }
    });

    await toggleProxyCommand(vscodeApi, proxyManager, notificationService, async () => {});

    assert.equal(proxyManager.toggleCalls, 1);
    assert.equal(informationMessages.length, 1);
    assert.match(informationMessages[0] ?? '', /enabled/i);
  });

  it('toggleProxyCommand prompts to configure when missing configuration', async () => {
    const executed: string[] = [];
    const proxyManager = createProxyManagerStub({ hasConfiguration: false });

    const vscodeApi = createVscodeApiStub({
      executeCommand: async (command) => {
        executed.push(command);
      }
    });
    const notificationService = createNotificationServiceStub({
      onWarning: async (): Promise<string | undefined> => 'configure'
    });

    await toggleProxyCommand(vscodeApi, proxyManager, notificationService, async () => {});
    assert.deepEqual(executed, ['proxyToggler.configure']);
  });

  it('commands render keychain errors with actionable messages', async () => {
    const errorMessages: string[] = [];
    const proxyManager = createProxyManagerStub({ hasConfiguration: true });
    proxyManager.enableProxy = async (): Promise<void> => {
      throw new KeychainError('retrieve', KeychainErrorReason.LOCKED);
    };

    const vscodeApi = createVscodeApiStub();
    const notificationService = createNotificationServiceStub({
      onError: async (message) => {
        errorMessages.push(message);
      }
    });

    await enableProxyCommand(vscodeApi, proxyManager, notificationService, async () => {});

    assert.equal(errorMessages.length, 1);
    assert.match(errorMessages[0] ?? '', /locked/i);
  });

  it('enableProxyCommand opens settings when configuration update fails', async () => {
    const executed: Array<{ command: string; args: unknown[] }> = [];
    const errorMessages: Array<{ message: string; actions: NotificationAction[] }> = [];

    const vscodeApi = createVscodeApiStub({
      executeCommand: async (command, ...args) => {
        executed.push({ command, args });
      }
    });

    const proxyManager = createProxyManagerStub({ hasConfiguration: true });
    proxyManager.enableProxy = async (): Promise<void> => {
      throw new ConfigurationError('enable', 'proxy');
    };

    const notificationService = createNotificationServiceStub({
      onError: async (message, actions) => {
        errorMessages.push({ message, actions });
      },
      errorSelection: 'openSettings'
    });

    await enableProxyCommand(vscodeApi, proxyManager, notificationService, async () => {});

    assert.equal(errorMessages.length, 1);
    assert.ok(errorMessages[0]?.actions.some((action) => action.id === 'openSettings'));
    assert.deepEqual(executed, [
      { command: 'workbench.action.openSettings', args: ['http.proxy'] }
    ]);
  });

  it('enableProxyCommand offers a "Disable Proxy" action after enabling', async () => {
    const executed: string[] = [];

    const vscodeApi = createVscodeApiStub({
      executeCommand: async (command) => {
        executed.push(command);
      }
    });

    const proxyManager = createProxyManagerStub({ hasConfiguration: true });
    const notificationService = createNotificationServiceStub({ successSelection: 'disableProxy' });

    await enableProxyCommand(vscodeApi, proxyManager, notificationService, async () => {});

    assert.deepEqual(executed, ['proxyToggler.disable']);
  });

  it('disableProxyCommand opens settings when configuration update fails', async () => {
    const executed: Array<{ command: string; args: unknown[] }> = [];

    const vscodeApi = createVscodeApiStub({
      executeCommand: async (command, ...args) => {
        executed.push({ command, args });
      }
    });

    const proxyManager = createProxyManagerStub({ hasConfiguration: true });
    proxyManager.disableProxy = async (): Promise<void> => {
      throw new ConfigurationError('disable', 'noProxy');
    };

    const notificationService = createNotificationServiceStub({ errorSelection: 'openSettings' });

    await disableProxyCommand(vscodeApi, proxyManager, notificationService, async () => {});

    assert.deepEqual(executed, [
      { command: 'workbench.action.openSettings', args: ['http.noProxy'] }
    ]);
  });

  it('toggleProxyCommand opens settings when configuration update fails', async () => {
    const executed: Array<{ command: string; args: unknown[] }> = [];

    const vscodeApi = createVscodeApiStub({
      executeCommand: async (command, ...args) => {
        executed.push({ command, args });
      }
    });

    const proxyManager = createProxyManagerStub({ hasConfiguration: true, isEnabled: false });
    proxyManager.toggleProxy = async (): Promise<boolean> => {
      throw new ConfigurationError('enable', 'proxyStrictSSL');
    };

    const notificationService = createNotificationServiceStub({ errorSelection: 'openSettings' });

    await toggleProxyCommand(vscodeApi, proxyManager, notificationService, async () => {});

    assert.deepEqual(executed, [
      { command: 'workbench.action.openSettings', args: ['http.proxyStrictSSL'] }
    ]);
  });

  it('toggleProxyCommand offers a "Disable Proxy" action after enabling', async () => {
    const executed: string[] = [];

    const vscodeApi = createVscodeApiStub({
      executeCommand: async (command) => {
        executed.push(command);
      }
    });

    const proxyManager = createProxyManagerStub({
      hasConfiguration: true,
      isEnabled: false,
      toggleResult: true
    });
    const notificationService = createNotificationServiceStub({ successSelection: 'disableProxy' });

    await toggleProxyCommand(vscodeApi, proxyManager, notificationService, async () => {});

    assert.deepEqual(executed, ['proxyToggler.disable']);
  });
});

function createProxyManagerStub(options: {
  hasConfiguration: boolean;
  isEnabled?: boolean;
  toggleResult?: boolean;
}): ProxyManagerStub & { enableCalls: number; disableCalls: number; toggleCalls: number } {
  let enableCalls = 0;
  let disableCalls = 0;
  let toggleCalls = 0;

  return {
    get enableCalls(): number {
      return enableCalls;
    },
    get disableCalls(): number {
      return disableCalls;
    },
    get toggleCalls(): number {
      return toggleCalls;
    },
    hasConfiguration: (): boolean => options.hasConfiguration,
    getState: (): { isEnabled: boolean; hasConfiguration: boolean } => ({
      isEnabled: options.isEnabled ?? false,
      hasConfiguration: options.hasConfiguration
    }),
    enableProxy: async (): Promise<void> => {
      enableCalls += 1;
    },
    disableProxy: async (): Promise<void> => {
      disableCalls += 1;
    },
    toggleProxy: async (): Promise<boolean> => {
      toggleCalls += 1;
      return options.toggleResult ?? !options.isEnabled;
    }
  };
}

function createVscodeApiStub(options?: {
  confirmBeforeToggle?: boolean;
  executeCommand?: (command: string, ...args: unknown[]) => PromiseLike<unknown>;
}): Parameters<typeof toggleProxyCommand>[0] {
  const confirmBeforeToggle = options?.confirmBeforeToggle ?? false;

  return {
    commands: {
      executeCommand: options?.executeCommand ?? (async (): Promise<unknown> => undefined)
    },
    workspace: {
      getConfiguration: () => ({
        get: <T>(_key: string, defaultValue?: T): T =>
          _key === 'confirmBeforeToggle'
            ? (confirmBeforeToggle as unknown as T)
            : (defaultValue as T)
      })
    }
  };
}

function createNotificationServiceStub(options?: {
  onSuccess?: (message: string, actions: NotificationAction[]) => Promise<void>;
  onWarning?: (message: string, actions: NotificationAction[]) => Promise<string | undefined>;
  onError?: (message: string, actions: NotificationAction[]) => Promise<void>;
  successSelection?: string;
  errorSelection?: string;
}): {
  showSuccess: (message: string, ...actions: NotificationAction[]) => Promise<string | undefined>;
  showWarning: (message: string, ...actions: NotificationAction[]) => Promise<string | undefined>;
  showError: (message: string, ...actions: NotificationAction[]) => Promise<string | undefined>;
} {
  return {
    showSuccess: async (message, ...actions) => {
      await options?.onSuccess?.(message, actions);
      return options?.successSelection;
    },
    showWarning: async (message, ...actions) =>
      options?.onWarning ? options.onWarning(message, actions) : actions[0]?.id,
    showError: async (message, ...actions) => {
      await options?.onError?.(message, actions);
      return options?.errorSelection;
    }
  };
}
