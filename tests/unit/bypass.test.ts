import { strict as assert } from 'node:assert';

import { extensionsSendDirect, windowSendsDirect } from '../../src/core/bypass';

// [host, bypass list, sent direct by the window, sent direct by extensions]
type Case = [string, string[], boolean, boolean];

describe('bypass rules', () => {
  const cases: Case[] = [
    // Both agree on exact names and on subdomains of a "." domain (GLOSSARY.md, Bypass pattern).
    ['example.com', ['example.com'], true, true],
    ['api.example.com', ['.example.com'], true, true],
    // Extensions treat "x" and ".x" alike: the domain and every subdomain.
    ['api.example.com', ['example.com'], false, true],
    ['example.com', ['.example.com'], false, true],
    // Extensions never match "*.x"; the window reads it as a glob.
    ['api.example.com', ['*.example.com'], true, false],
    // A lone "*" sends everything direct for both: the window reads it as a glob.
    ['example.com', ['*'], true, true],
    // Loopback always goes direct for both.
    ['localhost', [], true, true],
    ['127.0.0.1', [], true, true],
    ['::1', [], true, true],
    // The window also sends the rest of 127/8, *.localhost, link-local and dotless hosts direct.
    ['127.0.0.2', [], true, false],
    ['app.localhost', [], true, false],
    ['169.254.10.1', [], true, false],
    ['intranet', [], true, false],
    // IP addresses match exactly.
    ['10.0.0.1', ['10.0.0.1'], true, true],
    ['example.com', [], false, false],
    // Letter case does not matter.
    ['API.Example.COM', ['.example.com'], true, true]
  ];

  for (const [host, patterns, window, extensions] of cases) {
    it(`${host} with [${patterns.join(', ')}]: window ${window}, extensions ${extensions}`, () => {
      assert.equal(windowSendsDirect(host, patterns), window);
      assert.equal(extensionsSendDirect(host, patterns), extensions);
    });
  }
});
