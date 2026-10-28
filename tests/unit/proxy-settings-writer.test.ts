import { strict as assert } from 'node:assert';

import { ProfileApplyError } from '../../src/core/proxy-manager';
import {
  ConfigurationError,
  failedSettingWrite,
  ProxySettingsWriter
} from '../../src/core/proxy-settings-writer';
import { createHttpSettings } from '../support/fakes';

const VALUES = {
  proxy: 'http://proxy.example.com:8080',
  proxyStrictSSL: true,
  noProxy: 'localhost'
};

// User settings that differ from VALUES, so a test can tell a restore from a clear.
const PREVIOUS_SETTINGS = {
  proxy: 'http://old.example.com:3128',
  proxyStrictSSL: false,
  noProxy: ['old.internal']
};

describe('ProxySettingsWriter', () => {
  it('restores the settings it already wrote when a later write fails', async () => {
    const httpSettings = createHttpSettings({ failKey: 'noProxy', current: PREVIOUS_SETTINGS });

    await assert.rejects(
      () => new ProxySettingsWriter(httpSettings).apply(VALUES),
      (error: unknown) => {
        assert.ok(error instanceof ConfigurationError);
        assert.equal(error.operation, 'enable');
        assert.equal(error.key, 'noProxy');
        assert.match(String(error.cause), /Failed to update noProxy/);
        return true;
      }
    );
    assert.deepEqual(httpSettings.current, PREVIOUS_SETTINGS);
  });

  it('keeps restoring after a restore fails and names the settings it could not restore', async () => {
    const httpSettings = createHttpSettings({
      current: PREVIOUS_SETTINGS,
      // http.noProxy cannot be written, and writing the earlier http.proxy back fails too.
      failWhen: ({ key, value }) =>
        key === 'noProxy' || (key === 'proxy' && value === PREVIOUS_SETTINGS.proxy)
    });

    await assert.rejects(
      () => new ProxySettingsWriter(httpSettings).apply(VALUES),
      (error: unknown) => {
        assert.ok(error instanceof ConfigurationError);
        assert.deepEqual([...error.restoreErrors.keys()], ['proxy']);
        assert.match(error.toUserMessage(), /"http\.proxy"/);
        assert.doesNotMatch(error.toUserMessage(), /"http\.proxyStrictSSL"/);
        return true;
      }
    );
    assert.equal(httpSettings.current.proxy, VALUES.proxy);
    assert.equal(httpSettings.current.proxyStrictSSL, PREVIOUS_SETTINGS.proxyStrictSSL);
  });

  it('restores unset settings as unset, not as the defaults VS Code reports for them', async () => {
    const httpSettings = createHttpSettings({
      failKey: 'noProxy',
      defaults: { proxyStrictSSL: true }
    });

    await assert.rejects(() => new ProxySettingsWriter(httpSettings).apply(VALUES));

    assert.deepEqual(httpSettings.current, {
      proxy: undefined,
      proxyStrictSSL: undefined,
      noProxy: undefined
    });
  });

  it('leaves the settings it cleared cleared when a later clear fails', async () => {
    const httpSettings = createHttpSettings({
      failKey: 'proxyStrictSSL',
      current: PREVIOUS_SETTINGS
    });

    await assert.rejects(
      () => new ProxySettingsWriter(httpSettings).clear(),
      (error: unknown) => {
        assert.ok(error instanceof ConfigurationError);
        assert.equal(error.operation, 'disable');
        assert.equal(error.key, 'proxyStrictSSL');
        assert.equal(error.restoreErrors.size, 0);
        return true;
      }
    );
    assert.deepEqual(httpSettings.current, {
      proxy: undefined,
      proxyStrictSSL: false,
      noProxy: ['old.internal']
    });
  });

  it('clears the proxy settings in order', async () => {
    const httpSettings = createHttpSettings({ current: PREVIOUS_SETTINGS });

    await new ProxySettingsWriter(httpSettings).clear();

    assert.deepEqual(httpSettings.updates, [
      { key: 'proxy', value: undefined },
      { key: 'proxyStrictSSL', value: undefined },
      { key: 'noProxy', value: undefined }
    ]);
  });

  it('applies the proxy settings in order', async () => {
    const httpSettings = createHttpSettings();

    await new ProxySettingsWriter(httpSettings).apply(VALUES);

    assert.deepEqual(httpSettings.updates, [
      { key: 'proxy', value: 'http://proxy.example.com:8080' },
      { key: 'proxyStrictSSL', value: true },
      { key: 'noProxy', value: 'localhost' }
    ]);
  });
});

describe('failedSettingWrite', () => {
  it('finds the failed setting write behind wrapping errors', () => {
    const failure = new ConfigurationError('enable', 'proxy');

    assert.equal(failedSettingWrite(failure), failure);
    assert.equal(failedSettingWrite(new ProfileApplyError('Work', failure)), failure);
    assert.equal(
      failedSettingWrite(new Error('outer', { cause: new Error('inner', { cause: failure }) })),
      failure
    );
    assert.equal(failedSettingWrite(new Error('plain')), undefined);
    assert.equal(failedSettingWrite('text'), undefined);
  });

  it('stops at a cause chain that loops', () => {
    const loop = new Error('loop');
    loop.cause = loop;

    assert.equal(failedSettingWrite(loop), undefined);
  });
});
