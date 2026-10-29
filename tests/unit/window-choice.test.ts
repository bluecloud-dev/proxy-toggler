import { strict as assert } from 'node:assert';

import { choiceMadeBy, isInEffect, readDefaultProfile } from '../../src/core/window-choice';

const WORK = {
  name: 'Work',
  proxyUrl: 'http://proxy.example.com:8080',
  strictSSL: true,
  bypassList: []
};

const ON_WORK = { isEnabled: true, hasConfiguration: true, currentProfile: WORK };
const OFF_WORK = { isEnabled: false, hasConfiguration: true, currentProfile: WORK };
const IN_STEP = { settingsHoldProxy: true, drift: false };

describe('readDefaultProfile', () => {
  it('reads a profile name, or false for no proxy', () => {
    assert.deepEqual(readDefaultProfile(' Work '), { kind: 'profile', name: 'Work' });
    assert.deepEqual(readDefaultProfile(false), { kind: 'off' });
  });

  it('sets no default for anything else, so the window leaves the proxy alone', () => {
    for (const value of [undefined, null, true, '', '  ', 42, ['Work']]) {
      assert.equal(readDefaultProfile(value), undefined);
    }
  });
});

describe('choiceMadeBy', () => {
  it('takes the profile a manual change turned on, or off', () => {
    assert.deepEqual(choiceMadeBy({ kind: 'on', profile: WORK }), {
      kind: 'profile',
      name: 'Work'
    });
    assert.deepEqual(choiceMadeBy({ kind: 'off', profile: WORK }), { kind: 'off' });
    assert.deepEqual(choiceMadeBy({ kind: 'saved', profile: WORK, isOn: true }), {
      kind: 'profile',
      name: 'Work'
    });
  });

  it('takes nothing from a change that leaves the proxy as it was', () => {
    assert.equal(choiceMadeBy({ kind: 'saved', profile: WORK, isOn: false }), undefined);
    assert.equal(choiceMadeBy({ kind: 'gone', name: 'Work', change: 'switch' }), undefined);
    assert.equal(choiceMadeBy({ kind: 'notConfigured' }), undefined);
    assert.equal(choiceMadeBy({ kind: 'writeFailed' }), undefined);
  });
});

describe('isInEffect', () => {
  it('holds for the profile that is on, whatever the letter case', () => {
    assert.equal(isInEffect({ kind: 'profile', name: 'work' }, ON_WORK, IN_STEP), true);
    assert.equal(isInEffect({ kind: 'profile', name: 'Home' }, ON_WORK, IN_STEP), false);
    assert.equal(isInEffect({ kind: 'profile', name: 'Work' }, OFF_WORK, IN_STEP), false);
  });

  it('does not hold for a profile while the settings drifted from it', () => {
    assert.equal(
      isInEffect({ kind: 'profile', name: 'Work' }, ON_WORK, {
        settingsHoldProxy: true,
        drift: true
      }),
      false
    );
  });

  it('holds for off only while the settings hold no proxy', () => {
    const noProxy = { settingsHoldProxy: false, drift: false };
    assert.equal(isInEffect({ kind: 'off' }, OFF_WORK, noProxy), true);
    assert.equal(isInEffect({ kind: 'off' }, OFF_WORK, IN_STEP), false);
    assert.equal(isInEffect({ kind: 'off' }, ON_WORK, IN_STEP), false);
  });
});
