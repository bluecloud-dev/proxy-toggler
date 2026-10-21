import * as net from 'node:net';
import type { Duplex } from 'node:stream';
import * as tls from 'node:tls';

import { defaultPortOf } from './match';

// The result of a test connection, shown once and never logged or stored.
export type TestVerdict = { outcome: 'pass' | 'warn' | 'fail' | 'skip'; message: string };

export type TestOptions = {
  // How long to wait for each answer; 10 seconds by default.
  timeoutMs?: number;
  // The certificate authorities to trust; Node's built-in roots by default, never the OS store.
  ca?: readonly string[];
};

const DEFAULT_TIMEOUT_MS = 10_000;

// Tests a proxy directly, not through VS Code's networking. An https:// target goes through a
// CONNECT tunnel, with TLS to the proxy first when the proxy is https://, then TLS to the target
// and HEAD /. An http:// target is requested through the proxy without a tunnel.
export async function testConnection(
  proxyUrl: string,
  targetUrl: string,
  options: TestOptions = {}
): Promise<TestVerdict> {
  const proxy = new URL(proxyUrl);
  if (proxy.protocol !== 'http:' && proxy.protocol !== 'https:') {
    return {
      outcome: 'skip',
      message:
        'Test Connection covers only HTTP and HTTPS proxies, so it did not test this SOCKS proxy.'
    };
  }

  const target = new URL(targetUrl);
  const settings = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ca: [...(options.ca ?? tls.rootCertificates)]
  };

  let socket: net.Socket;
  try {
    socket = await connectToProxy(proxy, settings);
  } catch (error: unknown) {
    return {
      outcome: 'fail',
      message: `Could not reach the proxy at ${proxy.host}: ${reasonFor(error, settings.timeoutMs)}.`
    };
  }

  try {
    return target.protocol === 'https:'
      ? await throughTunnel(socket, target, settings)
      : await throughProxy(socket, target, settings.timeoutMs);
  } catch (error: unknown) {
    return { outcome: 'fail', message: `${reasonFor(error, settings.timeoutMs)}.` };
  } finally {
    socket.destroy();
  }
}

type Settings = { timeoutMs: number; ca: string[] };

class TimeoutError extends Error {}

function connectToProxy(proxy: URL, settings: Settings): Promise<net.Socket> {
  // The URL keeps the brackets of an IPv6 host; sockets want the bare address.
  const host = proxy.hostname.replace(/^\[(.*)\]$/, '$1');
  const port = Number(proxy.port || defaultPortOf(proxy.protocol));

  return new Promise((resolve, reject) => {
    const secure = proxy.protocol === 'https:';
    const socket = secure
      ? // No servername for an IP address, which TLS SNI does not allow.
        tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, ca: settings.ca })
      : net.connect({ host, port });
    socket.setTimeout(settings.timeoutMs, () => socket.destroy(new TimeoutError()));
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

async function throughTunnel(
  socket: net.Socket,
  target: URL,
  settings: Settings
): Promise<TestVerdict> {
  const authority = `${target.hostname}:${target.port || '443'}`;
  socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
  const tunnel = await readHead(socket, settings.timeoutMs);
  if (tunnel.status === 407) {
    return signInWarning();
  }
  if (tunnel.status !== 200) {
    return {
      outcome: 'fail',
      message: `The proxy refused the tunnel to ${target.host}: ${tunnel.status} ${tunnel.statusText}.`
    };
  }

  const host = target.hostname.replace(/^\[(.*)\]$/, '$1');
  const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const connection = tls.connect({
      socket,
      servername: net.isIP(host) ? undefined : host,
      ca: settings.ca
    });
    connection.once('secureConnect', () => resolve(connection));
    connection.once('error', (error: Error) =>
      reject(new Error(`The TLS connection to ${target.host} failed: ${error.message}`))
    );
  });
  try {
    secure.write(`HEAD / HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\n\r\n`);
    const answer = await readHead(secure, settings.timeoutMs);
    return {
      outcome: 'pass',
      message: `The proxy opened a tunnel to ${target.host}, which answered ${answer.status}.`
    };
  } finally {
    secure.destroy();
  }
}

async function throughProxy(
  socket: net.Socket,
  target: URL,
  timeoutMs: number
): Promise<TestVerdict> {
  socket.write(`HEAD ${target.href} HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\n\r\n`);
  const answer = await readHead(socket, timeoutMs);
  if (answer.status === 407) {
    return signInWarning();
  }
  if (answer.status >= 200 && answer.status < 400) {
    return {
      outcome: 'pass',
      message: `The proxy fetched ${target.href}, which answered ${answer.status}.`
    };
  }
  return {
    outcome: 'warn',
    message: `The proxy answered ${answer.status} ${answer.statusText} for ${target.href}. The proxy may have sent this status rather than ${target.host}.`
  };
}

function signInWarning(): TestVerdict {
  return {
    outcome: 'warn',
    message:
      "The proxy asks for a sign-in (407). VS Code's login dialog answers it for VS Code; this test cannot sign in."
  };
}

type Head = { status: number; statusText: string };

// Reads an HTTP response head, and pauses the socket so that a tunnel loses no byte.
function readHead(socket: Duplex, timeoutMs: number): Promise<Head> {
  return new Promise((resolve, reject) => {
    let received = Buffer.alloc(0);
    const finish = (error: Error | undefined, head?: Head): void => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('end', onEnd);
      socket.pause();
      if (error) {
        reject(error);
      } else if (head) {
        resolve(head);
      }
    };
    const onData = (chunk: Buffer): void => {
      received = Buffer.concat([received, chunk]);
      const end = received.indexOf('\r\n\r\n');
      if (end === -1) {
        return;
      }
      const statusLine = received.subarray(0, end).toString('latin1').split('\r\n')[0] ?? '';
      const match = /^HTTP\/\d(?:\.\d)? (\d{3})(?: (.*))?$/.exec(statusLine);
      finish(
        match ? undefined : new Error('The proxy sent an answer that is not HTTP'),
        match ? { status: Number(match[1]), statusText: match[2] ?? '' } : undefined
      );
    };
    const onError = (error: Error): void => finish(error);
    const onEnd = (): void => finish(new Error('The connection closed before an answer came'));
    const timer = setTimeout(() => finish(new TimeoutError()), timeoutMs);
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('end', onEnd);
    socket.resume();
  });
}

function reasonFor(error: unknown, timeoutMs: number): string {
  if (error instanceof TimeoutError) {
    return `the proxy did not answer within ${timeoutMs / 1000} seconds`;
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ECONNREFUSED') {
    return 'the connection was refused';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'its host name was not found';
  }
  return error instanceof Error ? error.message : String(error);
}
