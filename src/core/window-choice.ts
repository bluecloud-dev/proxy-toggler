import { sameName } from './profiles';
import type { ToggleState } from './proxy-configuration';
import type { ProxyOutcome } from './proxy-outcome';

// What a window wants VS Code's proxy to be: a profile, named, or no proxy. See ADR 0006.
export type WindowChoice = { kind: 'profile'; name: string } | { kind: 'off' };

// Where the proxy in effect came from, when it is the window's choice: a change made in the window,
// the project's default, or the user's.
export type ChoiceOrigin = 'window' | 'project' | 'user';

// proxyToggler.defaultProfile holds a profile name, or false for no proxy; anything else sets no
// default, and the window leaves the proxy alone.
export function readDefaultProfile(value: unknown): WindowChoice | undefined {
  if (value === false) {
    return { kind: 'off' };
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return { kind: 'profile', name: value.trim() };
  }
  return undefined;
}

// The choice a manual change makes: the proxy state it left, if it changed it.
export function choiceMadeBy(
  outcome: ProxyOutcome | { kind: 'writeFailed' }
): WindowChoice | undefined {
  if (outcome.kind === 'on' || (outcome.kind === 'saved' && outcome.isOn)) {
    return { kind: 'profile', name: outcome.profile.name };
  }
  return outcome.kind === 'off' ? { kind: 'off' } : undefined;
}

// Whether VS Code's proxy already is what the choice asks for.
export function isInEffect(
  choice: WindowChoice,
  state: ToggleState,
  settings: { settingsHoldProxy: boolean; drift: boolean }
): boolean {
  if (choice.kind === 'off') {
    return !state.isEnabled && !settings.settingsHoldProxy;
  }
  return (
    state.isEnabled &&
    !settings.drift &&
    state.currentProfile !== undefined &&
    sameName(state.currentProfile.name, choice.name)
  );
}
