import type { VscodeApi } from './api';

// Returned by askText when the user presses the Back button.
export const BACK = Symbol('back');

export type TextStep = {
  title: string;
  // For a step of a multi-step flow.
  step?: number;
  totalSteps?: number;
  prompt: string;
  value?: string;
  placeholder?: string;
  canGoBack: boolean;
  // A message saying why the value cannot be used, or undefined when it can.
  validate(value: string): string | undefined;
};

// One step of a multi-step flow: settles with the accepted value, BACK, or undefined when the
// user closes it. Enter is refused while the value is invalid, and the reason shows as they type.
export function askText(
  vscodeApi: Pick<VscodeApi, 'QuickInputButtons' | 'window'>,
  step: TextStep
): Promise<string | typeof BACK | undefined> {
  return new Promise((resolve) => {
    const input = vscodeApi.window.createInputBox();
    input.title = step.title;
    input.step = step.step;
    input.totalSteps = step.totalSteps;
    input.prompt = step.prompt;
    input.placeholder = step.placeholder;
    input.value = step.value ?? '';
    input.buttons = step.canGoBack ? [vscodeApi.QuickInputButtons.Back] : [];
    // Keeps what the user typed when they click elsewhere to copy a value.
    input.ignoreFocusOut = true;

    let result: string | typeof BACK | undefined;
    input.onDidChangeValue((value) => {
      input.validationMessage = step.validate(value);
    });
    input.onDidTriggerButton((button) => {
      if (button === vscodeApi.QuickInputButtons.Back) {
        result = BACK;
        input.hide();
      }
    });
    input.onDidAccept(() => {
      const problem = step.validate(input.value);
      if (problem) {
        input.validationMessage = problem;
        return;
      }
      result = input.value;
      input.hide();
    });
    input.onDidHide(() => {
      input.dispose();
      resolve(result);
    });
    // A value the step opens with can already be refused, such as a name another window took. An
    // empty value is left alone, so a new field does not open with a complaint.
    if (input.value !== '') {
      input.validationMessage = step.validate(input.value);
    }
    input.show();
  });
}
