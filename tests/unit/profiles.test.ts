import { strict as assert } from 'node:assert';

import {
  checkProfiles,
  defaultProfileName,
  findCurrentProfile,
  readProfiles,
  validateProfileName
} from '../../src/core/profiles';

const WORK = {
  name: 'Work',
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: false,
  bypassList: ['.corp.example.com']
};

describe('readProfiles', () => {
  it('reads entries that have the shape of a profile', () => {
    assert.deepEqual(readProfiles([WORK]), [WORK]);
  });

  it('counts a missing strict SSL choice as on and a missing bypass list as empty', () => {
    assert.deepEqual(readProfiles([{ name: 'Home', proxyUrl: 'http://home.example:3128' }]), [
      { name: 'Home', proxyUrl: 'http://home.example:3128', strictSSL: true, bypassList: [] }
    ]);
  });

  it('keeps only the fields of a profile', () => {
    assert.deepEqual(readProfiles([{ ...WORK, color: 'blue' }]), [WORK]);
  });

  it('skips entries without a name or proxy URL', () => {
    const entries = [{ proxyUrl: WORK.proxyUrl }, { name: 'Nameless' }, 'Work', null, 42];

    assert.deepEqual(readProfiles(entries), []);
  });

  it('reads nothing from a value that is not a list', () => {
    for (const value of [undefined, null, 'Work', { name: 'Work' }]) {
      assert.deepEqual(readProfiles(value), [], JSON.stringify(value));
    }
  });
});

describe('findCurrentProfile', () => {
  const HOME = {
    name: 'Home',
    proxyUrl: 'http://home.example:3128',
    strictSSL: true,
    bypassList: []
  };

  it('is the profile with the remembered name, ignoring letter case', () => {
    assert.deepEqual(findCurrentProfile([HOME, WORK], { ...WORK, name: 'work' }), WORK);
  });

  it('is the profile with the remembered values when no profile has the name', () => {
    const renamed = { ...WORK, name: 'Office' };

    assert.deepEqual(findCurrentProfile([HOME, renamed], WORK), renamed);
  });

  it('is the first profile alphabetically when none has the remembered name or values', () => {
    const gone = { ...WORK, name: 'Gone', proxyUrl: 'http://gone.example:8080' };

    assert.deepEqual(findCurrentProfile([WORK, HOME], gone), HOME);
    assert.deepEqual(findCurrentProfile([WORK, HOME], undefined), HOME);
  });

  it('does not exist without profiles', () => {
    assert.equal(findCurrentProfile([], WORK), undefined);
  });
});

describe('defaultProfileName', () => {
  it('is the proxy host', () => {
    assert.equal(defaultProfileName('proxy.example.com', ['Work']), 'proxy.example.com');
  });

  it('counts up from " (2)" while the name is taken, ignoring letter case', () => {
    const taken = ['PROXY.example.com', 'proxy.example.com (2)'];

    assert.equal(defaultProfileName('proxy.example.com', taken), 'proxy.example.com (3)');
  });

  it('shortens a long host with "…" so that the name and any suffix fit in 30 characters', () => {
    const host = 'proxy-gateway-eu-west-1.corp.example.com';

    assert.equal(defaultProfileName(host, []), 'proxy-gateway-eu-west-1.corp.…');
    assert.equal(
      defaultProfileName(host, ['proxy-gateway-eu-west-1.corp.…']),
      'proxy-gateway-eu-west-1.c… (2)'
    );
  });
});

describe('checkProfiles', () => {
  const reasonFor = (entry: unknown): string | undefined =>
    checkProfiles([entry]).flagged[0]?.reason;

  it('flags entries that the UI would refuse, saying why', () => {
    const cases: Array<[unknown, RegExp]> = [
      ['Work', /not a profile/],
      [{ proxyUrl: WORK.proxyUrl }, /no name/],
      [{ ...WORK, name: '   ' }, /no name/],
      [{ ...WORK, name: 'x'.repeat(31) }, /longer than 30 characters/],
      [{ name: 'Work' }, /no proxy URL/],
      [{ ...WORK, proxyUrl: 'proxy.example.com:8080' }, /invalid proxy URL/],
      [{ ...WORK, proxyUrl: 'http://alice:secret@proxy.example.com:8080' }, /credentials/i],
      [{ ...WORK, strictSSL: 'no' }, /strictSSL/],
      [{ ...WORK, bypassList: '.corp' }, /not a list/],
      [{ ...WORK, bypassList: ['*'] }, /invalid bypass pattern/]
    ];

    for (const [entry, reason] of cases) {
      assert.match(reasonFor(entry) ?? 'not flagged', reason, JSON.stringify(entry));
    }
  });

  it('names a flagged entry by its name, or else by its position', () => {
    const { flagged } = checkProfiles([WORK, { name: 'Bad' }, { proxyUrl: WORK.proxyUrl }]);

    assert.deepEqual(
      flagged.map((entry) => entry.label),
      ['"Bad"', 'entry 3']
    );
  });

  it('hides later entries that repeat a name, ignoring letter case and spaces', () => {
    const { profiles, flagged } = checkProfiles([WORK, { ...WORK, name: ' WORK ' }]);

    assert.deepEqual(profiles, [WORK]);
    assert.match(flagged[0]?.reason ?? '', /repeats the name/);
  });

  it('lets the first entry with a name own it, even when that entry is invalid', () => {
    const { profiles, flagged } = checkProfiles([{ name: 'Work', proxyUrl: 'bad' }, WORK]);

    assert.deepEqual(profiles, []);
    assert.equal(flagged.length, 2);
  });

  it('trims names and proxy URLs', () => {
    const { profiles } = checkProfiles([
      { ...WORK, name: ' Work ', proxyUrl: ` ${WORK.proxyUrl} ` }
    ]);

    assert.deepEqual(profiles, [WORK]);
  });
});

describe('validateProfileName', () => {
  it('accepts a trimmed name of at most 30 characters that no entry holds', () => {
    assert.equal(validateProfileName(' Office ', ['Work', 'Home']), undefined);
    assert.equal(validateProfileName('x'.repeat(30), []), undefined);
  });

  it('refuses an empty name', () => {
    assert.match(validateProfileName('  ', []) ?? '', /enter a name/i);
  });

  it('refuses a name longer than 30 characters', () => {
    assert.match(validateProfileName('x'.repeat(31), []) ?? '', /30 characters/);
  });

  it('refuses a name an entry holds, ignoring letter case and spaces', () => {
    assert.match(validateProfileName(' WORK ', ['Work']) ?? '', /already/);
  });
});
