import type { Profile } from './profiles';

export type ToggleState = {
  isEnabled: boolean;
  hasConfiguration: boolean;
  // Present whenever a profile exists; computed on read, see findCurrentProfile.
  currentProfile?: Profile;
};
