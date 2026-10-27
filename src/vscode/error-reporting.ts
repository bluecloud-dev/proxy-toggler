import type * as vscode from 'vscode';

import type { Logger, VscodeApi } from './api';
import type { Notifier } from './notification-service';

export type RegisterCommand = (
  command: string,
  failureMessage: string,
  run: (...args: unknown[]) => Promise<void>
) => vscode.Disposable;

// Commands handle the errors they can explain; anything that escapes is logged here and shown
// with the command's failure message, so no failure is silent or reaches VS Code unhandled.
export function createCommandRegistrar(
  vscodeApi: Pick<VscodeApi, 'commands'>,
  logger: Logger,
  notificationService: Pick<Notifier, 'showError'>
): RegisterCommand {
  return (command, failureMessage, run) =>
    vscodeApi.commands.registerCommand(command, async (...args: unknown[]) => {
      try {
        await run(...args);
      } catch (error: unknown) {
        logger.error(`${command} failed`, error);
        await notificationService.showError(userMessageOf(error) ?? failureMessage);
      }
    });
}

export function runInBackground(logger: Logger, task: string, run: () => Promise<void>): void {
  // The async wrapper also catches a callback that throws before returning its promise.
  void (async () => {
    try {
      await run();
    } catch (error: unknown) {
      logger.error(`${task} failed`, error);
    }
  })();
}

type ExplainedError = Error & { toUserMessage(): string };

// An error that words its own message says what failed better than a command's fallback, so any
// error with toUserMessage() is shown in its own words, without a list of error classes.
function userMessageOf(error: unknown): string | undefined {
  return isExplained(error) ? error.toUserMessage() : undefined;
}

function isExplained(error: unknown): error is ExplainedError {
  return (
    error instanceof Error && typeof (error as Partial<ExplainedError>).toUserMessage === 'function'
  );
}
