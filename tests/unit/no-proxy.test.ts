import { strict as assert } from 'node:assert';

import { parseNoProxyList } from '../../src/core/no-proxy';

describe('parseNoProxyList', () => {
  it('splits a comma-separated list into trimmed, non-empty entries', () => {
    assert.deepEqual(parseNoProxyList(' localhost, 127.0.0.1 ,,'), ['localhost', '127.0.0.1']);
  });

  it('accepts the array shape that VS Code stores', () => {
    assert.deepEqual(parseNoProxyList([' localhost ', '', '*.example.com']), [
      'localhost',
      '*.example.com'
    ]);
  });

  it('returns no entries for missing or unexpected values', () => {
    assert.deepEqual(parseNoProxyList(undefined), []);
    assert.deepEqual(parseNoProxyList(42), []);
  });
});
