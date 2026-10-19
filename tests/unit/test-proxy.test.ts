import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import * as http from 'node:http';
import type { Socket } from 'node:net';

import type { TestProxy } from '../support/test-proxy';
import { PROXY_ANSWER, startTestProxy } from '../support/test-proxy';

const TARGET = 'origin.invalid';
const CREDENTIALS = { username: 'proxy-user', password: randomBytes(12).toString('hex') };
const RIGHT_AUTHORIZATION = basic(CREDENTIALS.username, CREDENTIALS.password);

type Reply = { status: number; authenticate: string | undefined; body: string };
type ConnectReply = { status: number; authenticate: string | undefined; socket: Socket };

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function authorizationHeader(authorization?: string): http.OutgoingHttpHeaders {
  return authorization === undefined ? {} : { 'Proxy-Authorization': authorization };
}

// Sends a request the way a client that uses the proxy does: the path is the absolute URL.
function requestThrough(proxy: TestProxy, url: string, authorization?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: proxy.port,
        path: url,
        headers: authorizationHeader(authorization)
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            authenticate: response.headers['proxy-authenticate'],
            body
          })
        );
      }
    );
    request.on('error', reject);
    request.end();
  });
}

function connectThrough(
  proxy: TestProxy,
  target: string,
  authorization?: string
): Promise<ConnectReply> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: proxy.port,
      method: 'CONNECT',
      path: target,
      headers: authorizationHeader(authorization)
    });
    request.on('connect', (response: http.IncomingMessage, socket: Socket) =>
      resolve({
        status: response.statusCode ?? 0,
        authenticate: response.headers['proxy-authenticate'],
        socket
      })
    );
    request.on('error', reject);
    request.end();
  });
}

function readToEnd(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (text += chunk));
    socket.on('end', () => resolve(text));
    socket.on('error', reject);
  });
}

describe('test proxy', () => {
  const proxies = new Set<TestProxy>();
  const sockets: Socket[] = [];

  const start = async (options?: Parameters<typeof startTestProxy>[0]): Promise<TestProxy> => {
    const proxy = await startTestProxy(options);
    proxies.add(proxy);
    return proxy;
  };

  const connect = async (
    proxy: TestProxy,
    target: string,
    authorization?: string
  ): Promise<ConnectReply> => {
    const reply = await connectThrough(proxy, target, authorization);
    sockets.push(reply.socket);
    return reply;
  };

  // Mocha waits for open handles, so a leftover socket or server would keep the run alive.
  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.destroy();
    }
    await Promise.all([...proxies].map((proxy) => proxy.close()));
    proxies.clear();
  });

  it('answers plain proxy requests itself and records them', async () => {
    const proxy = await start();

    const reply = await requestThrough(proxy, `http://${TARGET}/hello`);

    assert.deepEqual(reply, { status: 200, authenticate: undefined, body: PROXY_ANSWER });
    assert.deepEqual(proxy.requests, [
      { method: 'GET', url: `http://${TARGET}/hello`, host: TARGET, authorized: true }
    ]);
    assert.deepEqual(proxy.requestsFor('elsewhere.invalid'), []);
  });

  it('answers 407 to plain requests until the right credentials arrive', async () => {
    const proxy = await start({ credentials: CREDENTIALS });

    const missing = await requestThrough(proxy, `http://${TARGET}/`);
    const wrong = await requestThrough(proxy, `http://${TARGET}/`, basic('proxy-user', 'wrong'));
    const right = await requestThrough(proxy, `http://${TARGET}/`, RIGHT_AUTHORIZATION);

    assert.deepEqual(
      [missing, wrong].map(({ status, authenticate }) => ({ status, authenticate })),
      [
        { status: 407, authenticate: 'Basic realm="test-proxy"' },
        { status: 407, authenticate: 'Basic realm="test-proxy"' }
      ]
    );
    assert.deepEqual(right, { status: 200, authenticate: undefined, body: PROXY_ANSWER });
    assert.deepEqual(
      proxy.requests.map((request) => request.authorized),
      [false, false, true]
    );
  });

  it('refuses CONNECT with 502 when it has no port to tunnel to', async () => {
    const proxy = await start();

    const { status } = await connect(proxy, `${TARGET}:443`);

    assert.equal(status, 502);
    assert.deepEqual(proxy.requests, [
      { method: 'CONNECT', url: `${TARGET}:443`, host: TARGET, authorized: true }
    ]);
  });

  it('answers 407 to CONNECT until the right credentials arrive', async () => {
    const proxy = await start({ credentials: CREDENTIALS });

    const missing = await connect(proxy, `${TARGET}:443`);
    const right = await connect(proxy, `${TARGET}:443`, RIGHT_AUTHORIZATION);

    assert.equal(missing.status, 407);
    assert.equal(missing.authenticate, 'Basic realm="test-proxy"');
    // Past authentication, the proxy refuses the tunnel itself because it has no port to use.
    assert.equal(right.status, 502);
    assert.deepEqual(
      proxy.requestsFor(TARGET).map((request) => request.authorized),
      [false, true]
    );
  });

  it('tunnels CONNECT to the port it was given', async () => {
    // Any local server can stand at the far end; another test proxy answers the plain request
    // sent through the tunnel.
    const origin = await start();
    const proxy = await start({ tunnelTo: origin.port });

    const { status, socket } = await connect(proxy, `${TARGET}:80`);
    socket.write(`GET http://${TARGET}/hello HTTP/1.1\r\nHost: ${TARGET}\r\n\r\n`);
    const answer = await readToEnd(socket);

    assert.equal(status, 200);
    assert.match(answer, /^HTTP\/1\.1 200 /);
    assert.ok(answer.endsWith(`\r\n\r\n${PROXY_ANSWER}`), answer);
    assert.deepEqual(
      origin.requestsFor(TARGET).map((request) => request.url),
      [`http://${TARGET}/hello`]
    );
  });

  it('closes open tunnels when it closes', async () => {
    const origin = await start();
    const proxy = await start({ tunnelTo: origin.port });
    const { status, socket } = await connect(proxy, `${TARGET}:80`);
    assert.equal(status, 200);

    // The test closes the proxy itself, so the hook must not close it again.
    proxies.delete(proxy);
    await Promise.all([once(socket, 'close'), proxy.close()]);
  });
});
