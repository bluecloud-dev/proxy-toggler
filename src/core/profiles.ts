import { settingsMatch } from './match';
import type { ProxySettingValues } from './proxy-settings-writer';

// A profile as Proxy Toggler uses it. Entries in proxyToggler.profiles may hold more fields,
// which saves keep, but profiles never hold credentials (ADR 0003).
export type Profile = {
  name: string;
  proxyUrl: string;
  strictSSL: boolean;
  bypassList: string[];
};

// The proxyToggler.profiles setting, unchecked: hand edits and Settings Sync can put anything there.
export type ProfilesSetting = {
  read(): unknown;
  write(entries: readonly unknown[]): Promise<void>;
};

// The entries of the proxyToggler.profiles setting that have the shape of a profile.
export function readProfiles(value: unknown): Profile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry: unknown) => {
    const profile = asProfile(entry);
    return profile ? [profile] : [];
  });
}

// The current profile is the one with the remembered name, else the one with the remembered values,
// else the first alphabetically. Computed on every read and never saved, so a fallback never
// replaces what the record remembers.
export function findCurrentProfile(
  profiles: readonly Profile[],
  remembered: Profile | undefined
): Profile | undefined {
  const byName = remembered && profiles.find((profile) => sameName(profile.name, remembered.name));
  const byValues = remembered && profiles.find((profile) => sameValues(profile, remembered));
  return byName ?? byValues ?? sortByName(profiles)[0];
}

function sortByName(profiles: readonly Profile[]): Profile[] {
  return [...profiles].sort((left, right) => left.name.localeCompare(right.name));
}

// The entries with a profile saved into them: it replaces the first entry named `replacing`,
// keeping that entry's unknown fields, or is added at the end. Every other entry, valid or not,
// stays as it was, so versions that share the list through Settings Sync never strip each other's
// data (ADR 0002).
export function withProfile(
  entries: readonly unknown[],
  profile: Profile,
  replacing: string = profile.name
): unknown[] {
  const index = entries.findIndex((entry) => {
    const name = entryName(entry);
    return name !== undefined && sameName(name, replacing);
  });
  if (index === -1) {
    return [...entries, profile];
  }

  return entries.map((entry, entryIndex) =>
    entryIndex === index ? { ...(entry as object), ...profile } : entry
  );
}

const MAX_NAME_LENGTH = 30;

// The name a new profile gets: its proxy host, with " (2)", " (3)"... while an entry holds that
// name, shortened with "…" so that the name and its suffix fit in MAX_NAME_LENGTH.
export function defaultProfileName(host: string, takenNames: readonly string[]): string {
  const taken = new Set(takenNames.map((name) => name.toLowerCase()));
  for (let count = 1; ; count += 1) {
    const suffix = count === 1 ? '' : ` (${count})`;
    const name = shorten(host, MAX_NAME_LENGTH - suffix.length) + suffix;
    if (!taken.has(name.toLowerCase())) {
      return name;
    }
  }
}

function shorten(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

// The values a profile writes to VS Code's proxy settings.
export function profileSettingValues(profile: Profile): ProxySettingValues {
  return {
    proxy: profile.proxyUrl,
    proxyStrictSSL: profile.strictSSL,
    noProxy: profile.bypassList
  };
}

// The same proxy URL after parsing, strict SSL and set of bypass patterns, whatever the names.
export function sameValues(profile: Profile, other: Profile): boolean {
  return settingsMatch(profileSettingValues(other), profileSettingValues(profile));
}

function sameName(name: string, other: string): boolean {
  return name.toLowerCase() === other.toLowerCase();
}

// Every name an entry holds, valid or not: new names skip them all.
export function entryNames(entries: readonly unknown[]): string[] {
  return entries.flatMap((entry) => {
    const name = entryName(entry);
    return name === undefined ? [] : [name];
  });
}

function entryName(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }

  const { name } = entry as { name?: unknown };
  return typeof name === 'string' ? name : undefined;
}

function asProfile(entry: unknown): Profile | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }

  const { name, proxyUrl, strictSSL, bypassList } = entry as Record<string, unknown>;
  if (typeof name !== 'string' || typeof proxyUrl !== 'string') {
    return undefined;
  }

  // Hand-written entries may leave these out; they then start as a new profile does.
  return {
    name,
    proxyUrl,
    strictSSL: typeof strictSSL === 'boolean' ? strictSSL : true,
    bypassList: Array.isArray(bypassList)
      ? bypassList.filter((pattern): pattern is string => typeof pattern === 'string')
      : []
  };
}
