import type * as vscode from 'vscode';

import { KeychainError } from '../core/keychain-service';
import { ConfigurationError } from '../core/proxy-manager';
import type { Logger, VscodeApi } from './api';
import type { Notifier } from './notification-service';

export type RegisterCommand = (
  command: string,
  failureMessage: string,
  run: () => Promise<void>
) => vscode.Disposable;

// Commands handle the errors they can explain; anything that escapes is logged here and shown
// with the command's failure message, so no failure is silent or reaches VS Code unhandled.
export function createCommandRegistrar(
  vscodeApi: Pick<VscodeApi, 'commands'>,
  logger: Logger,
  notificationService: Pick<Notifier, 'showError'>
): RegisterCommand {
  return (command, failureMessage, run) =>
    vscodeApi.commands.registerCommand(command, async () => {
      try {
        await run();
      } catch (error: unknown) {
        logger.error(`${command} failed`, error);
        await notificationService.showError(userMessageFor(error, failureMessage));
      }
    });
}

export function runInBackground(logger: Logger, task: string, run: () => Promise<void>): void {
  run().catch((error: unknown) => {
    logger.error(`${task} failed`, error);
  });
}

function userMessageFor(error: unknown, failureMessage: string): string {
  return error instanceof KeychainError || error instanceof ConfigurationError
    ? error.toUserMessage()
    : failureMessage;
}
