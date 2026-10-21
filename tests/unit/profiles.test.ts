import { strict as assert } from 'node:assert';

import { findCurrentProfile, readProfiles } from '../../src/core/profiles';

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
