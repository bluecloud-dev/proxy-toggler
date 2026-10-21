import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import * as https from 'node:https';
import type { AddressInfo } from 'node:net';
import * as net from 'node:net';

import { testConnection } from '../../src/core/test-connection';
import { type Certificate, createCertificate } from '../support/certificates';
import { startTestProxy, type TestProxy } from '../support/test-proxy';

const AUTHORITY = createCertificate({ commonName: 'Proxy Toggler Test CA', isAuthority: true });
const ORIGIN = createCertificate({
  commonName: 'origin.test',
  altNames: ['origin.test'],
  issuer: AUTHORITY
});
// The test trusts its own authority, as a machine would trust a company's.
const TRUST = { ca: [AUTHORITY.cert] };

type Origin = { port: number; close(): Promise<void> };

async function startOrigin(certificate: Certificate): Promise<Origin> {
  const server = https.createServer(certificate, (_request, response) => {
    response.writeHead(204).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

const proxyUrl = (proxy: TestProxy, scheme = 'http'): string =>
  `${scheme}://127.0.0.1:${proxy.port}`;

describe('testConnection', () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((close) => close()));
  });

  async function proxyWith(options: Parameters<typeof startTestProxy>[0] = {}) {
    const proxy = await startTestProxy(options);
    cleanup.push(() => proxy.close());
    return proxy;
  }

  async function origin(certificate = ORIGIN) {
    const started = await startOrigin(certificate);
    cleanup.push(() => started.close());
    return started;
  }

  it('passes an https target that answers through the tunnel', async () => {
    const proxy = await proxyWith({ tunnelTo: (await origin()).port });

    const verdict = await testConnection(proxyUrl(proxy), 'https://origin.test', TRUST);

    assert.equal(verdict.outcome, 'pass', verdict.message);
    assert.match(verdict.message, /origin\.test/);
    assert.equal(proxy.requests[0]?.method, 'CONNECT');
  });

  it('tunnels through an https proxy, connecting to it with TLS first', async () => {
    const proxyCertificate = createCertificate({
      commonName: 'proxy',
      altNames: ['127.0.0.1'],
      issuer: AUTHORITY
    });
    const proxy = await proxyWith({ tunnelTo: (await origin()).port, tls: proxyCertificate });

    const verdict = await testConnection(proxyUrl(proxy, 'https'), 'https://origin.test', TRUST);

    assert.equal(verdict.outcome, 'pass', verdict.message);
  });

  it('passes an http target that answers 2xx or 3xx', async () => {
    for (const answerStatus of [200, 302]) {
      const proxy = await proxyWith({ answerStatus });

      const verdict = await testConnection(proxyUrl(proxy), 'http://origin.test/', TRUST);

      assert.equal(verdict.outcome, 'pass', `${answerStatus}: ${verdict.message}`);
      assert.equal(proxy.requests[0]?.url, 'http://origin.test/');
    }
  });

  it('warns that the proxy may have sent another status for an http target', async () => {
    const proxy = await proxyWith({ answerStatus: 503 });

    const verdict = await testConnection(proxyUrl(proxy), 'http://origin.test/', TRUST);

    assert.equal(verdict.outcome, 'warn');
    assert.match(verdict.message, /503/);
    assert.match(verdict.message, /proxy may have sent/);
  });

  it('warns that the proxy asks for a sign-in', async () => {
    const proxy = await proxyWith({ credentials: { username: 'alice', password: 'secret' } });

    for (const target of ['https://origin.test', 'http://origin.test/']) {
      const verdict = await testConnection(proxyUrl(proxy), target, TRUST);

      assert.equal(verdict.outcome, 'warn', target);
      assert.match(verdict.message, /407/, target);
      assert.match(verdict.message, /sign-in/, target);
    }
  });

  it('fails with its status when the proxy refuses the tunnel', async () => {
    const proxy = await proxyWith();

    const verdict = await testConnection(proxyUrl(proxy), 'https://origin.test', TRUST);

    assert.equal(verdict.outcome, 'fail');
    assert.match(verdict.message, /502/);
  });

  it('fails, saying why, when it cannot reach the proxy', async function () {
    // Resolving a name under .invalid can take a while on some networks.
    this.timeout(15_000);
    const closed = net.createServer();
    closed.listen(0, '127.0.0.1');
    await once(closed, 'listening');
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    // Reads whatever arrives and never answers. A socket left unread would never see the client
    // close, and would keep the server open.
    const silent = net.createServer((socket) => socket.resume());
    silent.listen(0, '127.0.0.1');
    await once(silent, 'listening');
    cleanup.push(() => new Promise((resolve) => silent.close(() => resolve())));
    const silentPort = (silent.address() as AddressInfo).port;

    const refused = await testConnection(`http://127.0.0.1:${closedPort}`, 'https://origin.test');
    const unknown = await testConnection(
      'http://no-such-proxy.invalid:8080',
      'https://origin.test'
    );
    const timedOut = await testConnection(`http://127.0.0.1:${silentPort}`, 'https://origin.test', {
      timeoutMs: 100
    });

    assert.deepEqual(
      [refused, unknown, timedOut].map((verdict) => verdict.outcome),
      ['fail', 'fail', 'fail']
    );
    assert.match(refused.message, /refused/);
    assert.match(unknown.message, /not found/);
    assert.match(timedOut.message, /did not answer/);
  });

  it('says that it covers only HTTP and HTTPS proxies', async () => {
    const verdict = await testConnection('socks5://127.0.0.1:1080', 'https://origin.test');

    assert.equal(verdict.outcome, 'skip');
    assert.match(verdict.message, /only HTTP and HTTPS proxies/);
  });
});
