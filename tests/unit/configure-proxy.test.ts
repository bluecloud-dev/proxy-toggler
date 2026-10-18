import { strict as assert } from 'node:assert';

import { configureProxyCommand } from '../../src/commands/configure-proxy';
import { KeychainError, KeychainErrorReason } from '../../src/core/keychain-service';
import type {
  LoadedProxyConfiguration,
  SaveConfigurationOptions
} from '../../src/core/proxy-manager';
import { ValidationError } from '../../src/core/validation-service';
import type { NotificationAction } from '../../src/vscode/notification-service';

type VscodeApiStub = Parameters<typeof configureProxyCommand>[0];
type ProxyManagerParam = Parameters<typeof configureProxyCommand>[1];

describe('configureProxyCommand', () => {
  it('saves configuration with defaults when user skips credentials', async () => {
    const inputs = ['http://proxy.example.com:8080', '', ''];
    const infoMessages: Array<{ message: string; actions: NotificationAction[] }> = [];
    const executedCommands: string[] = [];
    let refreshed = 0;

    const proxyManager = createProxyManagerStub();
    const vscodeApi = createVscodeApiStub({
      inputs,
      onExecuteCommand: (command) => {
        executedCommands.push(command);
      },
      onQuickPick: (items) => findByValue(items, true)
    });
    const notificationService = createNotificationServiceStub({
      onSuccess: async (message, actions) => {
        infoMessages.push({ message, actions });
        return 'notNow';
      }
    });

    await configureProxyCommand(
      vscodeApi,
      proxyManager as unknown as ProxyManagerParam,
      notificationService,
      async () => {
        refreshed += 1;
      }
    );

    assert.equal(proxyManager.saveCalls.length, 1);
    assert.deepEqual(proxyManager.saveCalls[0], {
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost,127.0.0.1'
      }
    });

    assert.equal(infoMessages.length, 1);
    assert.match(infoMessages[0]?.message ?? '', /saved/i);
    assert.equal(executedCommands.length, 0);
    assert.equal(refreshed, 1);
  });

  it('saves configuration with credentials when provided', async () => {
    const inputs = ['http://proxy.example.com:8080', 'alice', 'secret', ''];
    let refreshed = 0;

    const proxyManager = createProxyManagerStub();
    const vscodeApi = createVscodeApiStub({
      inputs,
      onQuickPick: (items) => findByValue(items, true)
    });
    const notificationService = createNotificationServiceStub({
      onSuccess: async (): Promise<string | undefined> => 'notNow'
    });

    await configureProxyCommand(
      vscodeApi,
      proxyManager as unknown as ProxyManagerParam,
      notificationService,
      async () => {
        refreshed += 1;
      }
    );

    assert.equal(proxyManager.saveCalls.length, 1);
    assert.deepEqual(proxyManager.saveCalls[0], {
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost,127.0.0.1'
      },
      credentials: {
        username: 'alice',
        password: 'secret'
      }
    });
    assert.equal(refreshed, 1);
  });

  it('can keep stored credentials without retrieving them', async () => {
    const inputs = ['http://proxy.example.com:8080', 'localhost'];
    let refreshed = 0;
    const proxyManager = createProxyManagerStub({
      loadResult: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: false,
        noProxy: 'localhost',
        hasStoredCredentials: true
      }
    });

    const vscodeApi = createVscodeApiStub({
      inputs,
      onQuickPick: (items, callIndex) => {
        if (callIndex === 0) {
          return items[0];
        }
        return findByValue(items, false);
      }
    });
    const notificationService = createNotificationServiceStub({
      onSuccess: async (): Promise<string | undefined> => 'notNow'
    });

    await configureProxyCommand(
      vscodeApi,
      proxyManager as unknown as ProxyManagerParam,
      notificationService,
      async () => {
        refreshed += 1;
      }
    );

    assert.equal(proxyManager.saveCalls.length, 1);
    assert.deepEqual(proxyManager.saveCalls[0], {
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: false,
        noProxy: 'localhost'
      }
    });
    assert.equal(refreshed, 1);
  });

  it('can remove stored credentials', async () => {
    const inputs = ['http://proxy.example.com:8080', 'localhost'];
    let refreshed = 0;
    const proxyManager = createProxyManagerStub({
      loadResult: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost',
        hasStoredCredentials: true
      }
    });

    const vscodeApi = createVscodeApiStub({
      inputs,
      onQuickPick: (items, callIndex) => {
        if (callIndex === 0) {
          return items[2];
        }
        return findByValue(items, true);
      }
    });
    const notificationService = createNotificationServiceStub({
      onSuccess: async (): Promise<string | undefined> => 'notNow'
    });

    await configureProxyCommand(
      vscodeApi,
      proxyManager as unknown as ProxyManagerParam,
      notificationService,
      async () => {
        refreshed += 1;
      }
    );

    assert.equal(proxyManager.saveCalls.length, 1);
    assert.deepEqual(proxyManager.saveCalls[0], {
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost'
      },
      clearCredentials: true
    });
    assert.equal(refreshed, 1);
  });

  it('can update stored credentials when requested', async () => {
    const inputs = ['http://proxy.example.com:8080', 'bob', 'secret', 'localhost'];
    let refreshed = 0;
    const proxyManager = createProxyManagerStub({
      loadResult: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost',
        hasStoredCredentials: true
      }
    });

    const vscodeApi = createVscodeApiStub({
      inputs,
      onQuickPick: (items, callIndex) => {
        if (callIndex === 0) {
          return items[1];
        }
        return findByValue(items, true);
      }
    });
    const notificationService = createNotificationServiceStub({
      onSuccess: async (): Promise<string | undefined> => 'notNow'
    });

    await configureProxyCommand(
      vscodeApi,
      proxyManager as unknown as ProxyManagerParam,
      notificationService,
      async () => {
        refreshed += 1;
      }
    );

    assert.equal(proxyManager.saveCalls.length, 1);
    assert.deepEqual(proxyManager.saveCalls[0], {
      configuration: {
        proxyUrl: 'http://proxy.example.com:8080',
        strictSSL: true,
        noProxy: 'localhost'
      },
      credentials: {
        username: 'bob',
        password: 'secret'
      }
    });
    assert.equal(refreshed, 1);
  });

  it('executes enable command when user accepts the prompt', async () => {
    const inputs = ['http://proxy.example.com:8080', '', 'localhost'];
    const executedCommands: string[] = [];
    let refreshed = 0;

    const proxyManager = createProxyManagerStub();
    const vscodeApi = createVscodeApiStub({
      inputs,
      onExecuteCommand: (command) => {
        executedCommands.push(command);
      },
      onQuickPick: (items) => findByValue(items, true)
    });
    const notificationService = createNotificationServiceStub({
      onSuccess: async (): Promise<string | undefined> => 'enable'
    });

    await configureProxyCommand(
      vscodeApi,
      proxyManager as unknown as ProxyManagerParam,
      notificationService,
      async () => {
        refreshed += 1;
      }
    );

    assert.deepEqual(executedCommands, ['proxyToggler.enable']);
    assert.equal(refreshed, 1);
  });

  it('shows keychain errors without leaking secrets', async () => {
    const inputs = ['http://proxy.example.com:8080', '', 'localhost'];
    const errorMessages: string[] = [];
    let refreshed = 0;

    const proxyManager = createProxyManagerStub({
      saveImplementation: async () => {
        throw new KeychainError('store', KeychainErrorReason.PERMISSION_DENIED);
      }
    });

    const vscodeApi = createVscodeApiStub({
      inputs,
      onQuickPick: (items) => findByValue(items, true)
    });
    const notificationService = createNotificationServiceStub({
      onError: async (message) => {
        errorMessages.push(message);
      }
    });

    await configureProxyCommand(
      vscodeApi,
      proxyManager as unknown as ProxyManagerParam,
      notificationService,
      async () => {
        refreshed += 1;
      }
    );

    assert.equal(errorMessages.length, 1);
    assert.match(errorMessages[0] ?? '', /permission/i);
    assert.doesNotMatch(errorMessages[0] ?? '', /secret/i);
    assert.equal(refreshed, 0);
  });

  it('shows validation errors from saveConfiguration', async () => {
    const inputs = ['http://proxy.example.com:8080', '', 'localhost'];
    const errorMessages: string[] = [];
    let refreshed = 0;

    const proxyManager = createProxyManagerStub({
      saveImplementation: async () => {
        throw new ValidationError('proxyUrl', 'URL is required', ['http://proxy.example.com:8080']);
      }
    });

    const vscodeApi = createVscodeApiStub({
      inputs,
      onQuickPick: (items) => findByValue(items, true)
    });
    const notificationService = createNotificationServiceStub({
      onError: async (message) => {
        errorMessages.push(message);
      }
    });

    await configureProxyCommand(
      vscodeApi,
      proxyManager as unknown as ProxyManagerParam,
      notificationService,
      async () => {
        refreshed += 1;
      }
    );

    assert.equal(errorMessages.length, 1);
    assert.match(errorMessages[0] ?? '', /invalid proxyurl/i);
    assert.match(errorMessages[0] ?? '', /examples/i);
    assert.equal(refreshed, 0);
  });
});

function createProxyManagerStub(options?: {
  loadResult?: LoadedProxyConfiguration;
  saveImplementation?: (options: SaveConfigurationOptions) => Promise<void>;
}): {
  saveCalls: SaveConfigurationOptions[];
  loadConfiguration: () => Promise<LoadedProxyConfiguration | undefined>;
  saveConfiguration: (options: SaveConfigurationOptions) => Promise<void>;
} {
  const saveCalls: SaveConfigurationOptions[] = [];

  return {
    saveCalls,
    loadConfiguration: async (): Promise<LoadedProxyConfiguration | undefined> =>
      options?.loadResult,
    saveConfiguration: async (saveOptions: SaveConfigurationOptions): Promise<void> => {
      if (options?.saveImplementation) {
        await options.saveImplementation(saveOptions);
        return;
      }
      saveCalls.push(saveOptions);
    }
  };
}

function createVscodeApiStub(options: {
  inputs: string[];
  onExecuteCommand?: (command: string) => void;
  onQuickPick: (
    items: ReadonlyArray<Record<string, unknown>>,
    callIndex: number
  ) => Record<string, unknown> | undefined;
}): VscodeApiStub {
  let inputIndex = 0;
  let quickPickIndex = 0;

  return {
    l10n: {
      t: (message: string): string => message
    },
    window: {
      showInputBox: async (inputOptions): Promise<string | undefined> => {
        const value = options.inputs[inputIndex++];
        if (typeof value === 'string' && inputOptions.validateInput) {
          inputOptions.validateInput(value);
        }
        return value;
      },
      showQuickPick: async <T extends { label: string }>(
        items: readonly T[]
      ): Promise<T | undefined> => {
        const selected = options.onQuickPick(items, quickPickIndex++);
        return selected as T | undefined;
      }
    },
    commands: {
      executeCommand: async (command: string): Promise<unknown> => {
        options.onExecuteCommand?.(command);
        return undefined;
      }
    }
  };
}

function createNotificationServiceStub(options?: {
  onSuccess?: (message: string, actions: NotificationAction[]) => Promise<string | undefined>;
  onError?: (message: string, actions: NotificationAction[]) => Promise<void>;
}): {
  showSuccess: (message: string, ...actions: NotificationAction[]) => Promise<string | undefined>;
  showWarning: (message: string, ...actions: NotificationAction[]) => Promise<string | undefined>;
  showError: (message: string, ...actions: NotificationAction[]) => Promise<string | undefined>;
} {
  return {
    showSuccess: async (message, ...actions) =>
      options?.onSuccess ? options.onSuccess(message, actions) : undefined,
    showWarning: async (): Promise<string | undefined> => undefined,
    showError: async (message, ...actions) => {
      await options?.onError?.(message, actions);
      return undefined;
    }
  };
}

function findByValue(
  items: ReadonlyArray<Record<string, unknown>>,
  value: boolean
): Record<string, unknown> | undefined {
  return items.find((item) => item.value === value);
}
