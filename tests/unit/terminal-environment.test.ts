import { strict as assert } from 'node:assert';

import { terminalProxyVariables } from '../../src/core/terminal-proxy';
import { updateTerminalEnvironment } from '../../src/vscode/terminal-environment';
import { createFakeVscode } from '../support/fake-vscode';
import { createEnvironmentVariableCollection, createHttpSettings } from '../support/fakes';

const SETTINGS = {
  proxy: 'http://proxy.example.com:8080',
  proxyStrictSSL: true,
  noProxy: ['.corp.example.com']
};

const VARIABLES = terminalProxyVariables(SETTINGS);

function update(options: { optedIn?: boolean; settings?: object; held?: Record<string, string> }) {
  const vscode = createFakeVscode({
    settings: { 'proxyToggler.applyToTerminals': options.optedIn ?? true }
  });
  const collection = createEnvironmentVariableCollection(
    new Map(Object.entries(options.held ?? {}))
  );
  updateTerminalEnvironment(
    vscode,
    collection,
    createHttpSettings({ current: { ...SETTINGS, ...options.settings } })
  );
  return collection;
}

describe('updateTerminalEnvironment', () => {
  it('gives new terminals the proxy VS Code uses, and says so in the terminal', () => {
    const collection = update({});

    assert.deepEqual(Object.fromEntries(collection.variables), VARIABLES);
    const { description } = collection;
    assert.ok(typeof description === 'string');
    assert.match(description, /Git/);
  });

  it('leaves terminals alone unless the user opts in', () => {
    const collection = update({ optedIn: false });

    assert.equal(collection.variables.size, 0);
    assert.equal(collection.changes, 0);
  });

  it('takes the proxy away when the user opts out', () => {
    const collection = update({ optedIn: false, held: VARIABLES });

    assert.equal(collection.variables.size, 0);
  });

  it('takes the proxy away when VS Code stops using one', () => {
    const collection = update({ settings: { proxy: undefined }, held: VARIABLES });

    assert.equal(collection.variables.size, 0);
  });

  it('replaces variables that no longer match the settings', () => {
    const collection = update({
      held: { ...VARIABLES, HTTPS_PROXY: 'http://old.example.com:3128' }
    });

    assert.deepEqual(Object.fromEntries(collection.variables), VARIABLES);
  });

  // Each change asks open terminals to relaunch, so an unchanged proxy must not touch them.
  it('changes nothing when terminals already have these variables', () => {
    const collection = update({ held: VARIABLES });

    assert.equal(collection.changes, 0);
  });
});
