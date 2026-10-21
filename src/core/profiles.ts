import { settingsMatch } from './match';
import type { ProxySettingValues } from './proxy-settings-writer';
import { problemWith, validateBypassPattern, validateProxyUrl } from './validation';

const MAX_NAME_LENGTH = 30;

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

// An entry of proxyToggler.profiles that the switcher hides, and why. `label` names it for the
// user; `entry` is the entry as written, which may hold anything, so it is never shown or stored.
export type FlaggedEntry = { entry: unknown; label: string; reason: string };

// The profiles the switcher shows: the entries that pass the checks the UI applies to its own
// input, each owning its name. The first entry with a name owns it, valid or not, so later
// entries with that name are hidden too (ADR 0002).
export function checkProfiles(value: unknown): { profiles: Profile[]; flagged: FlaggedEntry[] } {
  const profiles: Profile[] = [];
  const flagged: FlaggedEntry[] = [];
  if (!Array.isArray(value)) {
    return { profiles, flagged };
  }

  const owned = new Set<string>();
  value.forEach((entry: unknown, index) => {
    const name = entryName(entry);
    const label = name ? `"${name}"` : `entry ${index + 1}`;
    if (name && owned.has(name.toLowerCase())) {
      flagged.push({ entry, label, reason: 'repeats the name of an earlier entry' });
      return;
    }
    if (name) {
      owned.add(name.toLowerCase());
    }

    const checked = toProfile(entry);
    if (typeof checked === 'string') {
      flagged.push({ entry, label, reason: checked });
    } else {
      profiles.push(checked);
    }
  });
  return { profiles, flagged };
}

export function readProfiles(value: unknown): Profile[] {
  return checkProfiles(value).profiles;
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

export function findProfileByName(profiles: readonly Profile[], name: string): Profile | undefined {
  return profiles.find((profile) => sameName(profile.name, name.trim()));
}

// Alphabetical, as the switcher lists them and the fallback picks the first.
export function sortByName(profiles: readonly Profile[]): Profile[] {
  return [...profiles].sort((left, right) => left.name.localeCompare(right.name));
}

// The entries with a profile saved over the first entry named `replacing`, keeping that entry's
// unknown fields. Every other entry, valid or not, stays as it was, so versions that share the
// list through Settings Sync never strip each other's data (ADR 0002).
export function withProfile(
  entries: readonly unknown[],
  profile: Profile,
  replacing: string
): unknown[] {
  const index = indexOfName(entries, replacing);
  return entries.map((entry, entryIndex) =>
    entryIndex === index ? { ...(entry as object), ...profile } : entry
  );
}

// The entries without the first one named `name`; every other entry stays.
export function withoutProfile(entries: readonly unknown[], name: string): unknown[] {
  const index = indexOfName(entries, name);
  return entries.filter((_, entryIndex) => entryIndex !== index);
}

function indexOfName(entries: readonly unknown[], name: string): number {
  return entries.findIndex((entry) => {
    const entryNameValue = entryName(entry);
    return entryNameValue !== undefined && sameName(entryNameValue, name.trim());
  });
}

// Why a name cannot be used for a new or renamed profile, or undefined when it can. Names are
// trimmed, at most MAX_NAME_LENGTH long, and unique ignoring case among every name an entry holds.
export function validateProfileName(
  name: string,
  takenNames: readonly string[]
): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'Enter a name.';
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `Use at most ${MAX_NAME_LENGTH} characters.`;
  }
  if (takenNames.some((taken) => sameName(taken, trimmed))) {
    return `"${trimmed}" is already used in proxyToggler.profiles.`;
  }
  return undefined;
}

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

export function sameName(name: string, other: string): boolean {
  return name.toLowerCase() === other.toLowerCase();
}

// Every name an entry holds, valid or not: new names skip them all.
export function entryNames(entries: readonly unknown[]): string[] {
  return entries.flatMap((entry) => {
    const name = entryName(entry);
    return name === undefined ? [] : [name];
  });
}

// The trimmed name of an entry, or undefined when it has none.
function entryName(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }

  const { name } = entry as { name?: unknown };
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed.length > 0 ? trimmed : undefined;
}

// The profile an entry holds, or the reason the UI would have refused it.
function toProfile(entry: unknown): Profile | string {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return 'is not a profile';
  }

  const { proxyUrl, strictSSL, bypassList } = entry as Record<string, unknown>;
  const name = entryName(entry);
  if (name === undefined) {
    return 'has no name';
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `has a name longer than ${MAX_NAME_LENGTH} characters`;
  }
  if (typeof proxyUrl !== 'string') {
    return 'has no proxy URL';
  }
  const urlProblem = problemWith(() => validateProxyUrl(proxyUrl));
  if (urlProblem) {
    return `has an invalid proxy URL: ${urlProblem}`;
  }
  // Hand-written entries may leave these two out; they then start as a new profile does.
  if (strictSSL !== undefined && typeof strictSSL !== 'boolean') {
    return 'has a strictSSL value that is neither true nor false';
  }
  const patterns = bypassList ?? [];
  if (!Array.isArray(patterns) || !patterns.every((pattern) => typeof pattern === 'string')) {
    return 'has a bypass list that is not a list of host names';
  }
  for (const pattern of patterns) {
    const patternProblem = problemWith(() => validateBypassPattern(pattern.trim()));
    if (patternProblem) {
      return `has an invalid bypass pattern: ${patternProblem}`;
    }
  }

  return {
    name,
    proxyUrl: proxyUrl.trim(),
    strictSSL: strictSSL ?? true,
    bypassList: patterns.map((pattern) => pattern.trim())
  };
}
