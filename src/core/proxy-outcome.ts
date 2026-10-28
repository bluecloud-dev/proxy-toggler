import type { Profile } from './profiles';

// What a proxy change did. Another window or Settings Sync can remove a profile or take a name
// while a change waits for the user, so those races end in an outcome rather than an error. A
// failed setting write still throws.
export type On = { kind: 'on'; profile: Profile };
// No profile when the proxy was turned off while not configured.
export type Off = { kind: 'off'; profile?: Profile };
// `isOn`: the saved profile is current and on.
type Saved = { kind: 'saved'; profile: Profile; renamedFrom?: string; isOn: boolean };
type Deleted = { kind: 'deleted'; name: string };
// `change` says what did not happen, so a delete can say the profile was already deleted.
export type Gone = { kind: 'gone'; name: string; change: 'switch' | 'save' | 'delete' };
export type NotConfigured = { kind: 'notConfigured' };
type NameTaken = { kind: 'nameTaken'; name: string; reason: string };

export type ProxyOutcome = On | Off | Saved | Deleted | Gone | NotConfigured | NameTaken;
