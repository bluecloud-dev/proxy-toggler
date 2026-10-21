import { once } from 'node:events';
import * as http from 'node:http';
import * as https from 'node:https';
import type { AddressInfo } from 'node:net';
import * as net from 'node:net';
import type { Duplex } from 'node:stream';

// The body of every plain request the proxy answers, so that a test can tell the proxy's answer
// from any other.
export const PROXY_ANSWER = 'answered by the test proxy';

const AUTHENTICATE = 'Basic realm="test-proxy"';

type BasicCredentials = { username: string; password: string };

type ProxiedRequest = {
  method: string;
  // As the client sent it: an absolute URL, or host:port for CONNECT.
  url: string;
  host: string;
  // False when the proxy answered 407 instead of serving the request.
  authorized: boolean;
};

type TestProxyOptions = {
  // Demands Basic authentication on every request, CONNECT included.
  credentials?: BasicCredentials;
  // A port on 127.0.0.1 that CONNECT requests are tunneled to. Without it, CONNECT is refused
  // with 502.
  tunnelTo?: number;
  // The status of the proxy's own answer to plain requests; 200 by default.
  answerStatus?: number;
  // Serves the proxy itself over TLS, as an https:// proxy.
  tls?: { cert: string; key: string };
};

export type TestProxy = {
  port: number;
  requests: readonly ProxiedRequest[];
  requestsFor(host: string): ProxiedRequest[];
  close(): Promise<void>;
};

// A forward proxy on 127.0.0.1 that records every request it receives. It answers plain-HTTP
// proxy requests itself, so tests need no origin server.
export async function startTestProxy(options: TestProxyOptions = {}): Promise<TestProxy> {
  const requests: ProxiedRequest[] = [];
  const sockets = new Set<Duplex>();
  const expectedAuthorization = options.credentials && basicAuthorization(options.credentials);

  const track = (socket: Duplex): void => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };

  // Records the request and says whether the proxy serves it.
  const admit = (request: http.IncomingMessage, host: string): boolean => {
    const authorized =
      expectedAuthorization === undefined ||
      request.headers['proxy-authorization'] === expectedAuthorization;
    requests.push({ method: request.method ?? '', url: request.url ?? '', host, authorized });
    return authorized;
  };

  const handle = (request: http.IncomingMessage, response: http.ServerResponse): void => {
    if (!admit(request, hostOf(request.url ?? ''))) {
      response.writeHead(407, { 'Proxy-Authenticate': AUTHENTICATE, Connection: 'close' });
      response.end();
      return;
    }

    response.writeHead(options.answerStatus ?? 200, {
      'Content-Type': 'text/plain',
      'Content-Length': Buffer.byteLength(PROXY_ANSWER),
      Connection: 'close'
    });
    response.end(PROXY_ANSWER);
  };
  const server = options.tls ? https.createServer(options.tls, handle) : http.createServer(handle);

  server.on(options.tls ? 'secureConnection' : 'connection', track);
  server.on('connect', (request: http.IncomingMessage, client: Duplex, head: Buffer) => {
    // The server stops handling errors on the socket it hands over. A client that resets the
    // connection only needs it closed, and an unhandled 'error' event would crash the process
    // that runs the proxy: in the integration tests, the extension host.
    client.on('error', () => client.destroy());

    if (!admit(request, hostOf(`http://${request.url ?? ''}`))) {
      client.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\n' +
          `Proxy-Authenticate: ${AUTHENTICATE}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
      );
      return;
    }

    if (options.tunnelTo === undefined) {
      client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }

    track(tunnel(client, head, options.tunnelTo));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  return {
    port: (server.address() as AddressInfo).port,
    requests,
    requestsFor: (host) => requests.filter((request) => request.host === host),
    // server.close() alone waits for open connections, including tunnels, to end.
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        for (const socket of sockets) {
          socket.destroy();
        }
      })
  };
}

// Relays bytes both ways between the client and the local port once the port accepts.
function tunnel(client: Duplex, head: Buffer, port: number): net.Socket {
  const upstream = net.connect(port, '127.0.0.1', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });

  // When either end fails, the other has nothing left to relay.
  const closeBoth = (): void => {
    client.destroy();
    upstream.destroy();
  };
  upstream.on('error', closeBoth);
  client.on('error', closeBoth);
  return upstream;
}

// The host from an absolute URL, or an empty string when the target does not parse.
function hostOf(target: string): string {
  return URL.canParse(target) ? new URL(target).hostname : '';
}

function basicAuthorization({ username, password }: BasicCredentials): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}
