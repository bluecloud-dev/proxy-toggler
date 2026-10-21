import { strict as assert } from 'node:assert';
import { randomBytes, randomUUID } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';

import * as sinon from 'sinon';
import * as vscode from 'vscode';

import type { TestProxy } from '../support/test-proxy';
import { PROXY_ANSWER, startTestProxy } from '../support/test-proxy';
import { activateExtension, dismissNotifications, useProfile } from './support';

// .invalid names never resolve (RFC 6761): a request that skips the proxy fails, and only the
// proxy can answer one. Loopback names would not do, because VS Code never proxies them.
const ORIGIN = 'origin.invalid';
const MARKETPLACE = 'marketplace.visualstudio.com';
const REQUEST_TIMEOUT_MS = 5000;
// How long VS Code's own processes may take to apply a settings change that the extension host
// already has.
const SETTLE_TIMEOUT_MS = 8000;
const PROBE_INTERVAL_MS = 100;
// Longer than the Extensions view waits before it runs a search.
const SEARCH_INTERVAL_MS = 1000;

type Outcome = { status: number; body: string } | { error: string };

const PROXY_ANSWERED: Outcome = { status: 200, body: PROXY_ANSWER };
const NOT_RESOLVED: Outcome = { error: 'ENOTFOUND' };

// Requests sent from here run in the extension host, where VS Code routes Node's http and https
// modules by its proxy settings, as for any extension. The promise never rejects: a failed
// request is an outcome to assert on.
function send(url: string): Promise<Outcome> {
  return new Promise((resolve) => {
    const onResponse = (response: http.IncomingMessage): void => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      response.on('error', (error) => resolve({ error: error.message }));
    };
    const options = { timeout: REQUEST_TIMEOUT_MS };
    const request = url.startsWith('https:')
      ? https.get(url, options, onResponse)
      : http.get(url, options, onResponse);
    request.on('timeout', () =>
      request.destroy(new Error(`No answer within ${REQUEST_TIMEOUT_MS} ms`))
    );
    request.on('error', (error: NodeJS.ErrnoException) =>
      resolve({ error: error.code ?? error.message })
    );
  });
}

// For a host without a proxy setting, the extension host asks VS Code's main process for a route
// and caches the answer per host. The main process applies a settings change a moment after the
// extension host, so this probes new names until one goes direct. A probe that still goes through
// a stale proxy leaves no cached route for the host under test.
async function waitUntilRequestsGoDirect(): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let outcome: Outcome;
  do {
    outcome = await send(`http://${randomUUID()}.invalid/`);
    if (isDeepStrictEqual(outcome, NOT_RESOLVED)) {
      return;
    }
    await delay(PROBE_INTERVAL_MS);
  } while (Date.now() < deadline);

  assert.fail(`Requests still go through a proxy after disabling: ${JSON.stringify(outcome)}`);
}

function httpConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('http');
}

function listRequests(proxy: TestProxy): string {
  return proxy.requests.map((request) => `${request.method} ${request.url}`).join(', ');
}

describe('network routing through the proxy', function () {
  // A request for a name that does not resolve, and VS Code's own requests, can take seconds.
  this.timeout(30000);

  const sandbox = sinon.createSandbox();
  const proxies: TestProxy[] = [];
  const settingsSetByTest = new Set<string>();

  const startProxy = async (options?: Parameters<typeof startTestProxy>[0]): Promise<TestProxy> => {
    const proxy = await startTestProxy(options);
    proxies.push(proxy);
    return proxy;
  };

  // Saves a configuration that points at the proxy and enables it, as a user would.
  const enableProxy = async (proxy: TestProxy, noProxy = ''): Promise<void> => {
    const proxyUrl = `http://127.0.0.1:${proxy.port}`;
    // An empty list stands for what 0.1.x saved by default, as these checks were written for it.
    const bypassList = noProxy ? noProxy.split(',') : ['localhost', '127.0.0.1'];
    await useProfile({ proxyUrl, bypassList, strictSSL: true });
    await vscode.commands.executeCommand('proxyToggler.enable');
    // Checked here so that a failed enable does not read as a routing failure.
    assert.equal(
      httpConfiguration().inspect<string>('proxy')?.globalValue,
      proxyUrl,
      'Enable did not write http.proxy'
    );
  };

  const setUserSetting = async (key: string, value: unknown): Promise<void> => {
    settingsSetByTest.add(key);
    await httpConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
  };

  before(async () => {
    await activateExtension();
  });

  beforeEach(() => dismissNotifications(sandbox));

  afterEach(async () => {
    try {
      // Disable while the notifications are still stubbed: the real "Proxy disabled" message
      // waits for a click, and the hook would time out.
      await vscode.commands.executeCommand('proxyToggler.disable');
      for (const key of settingsSetByTest) {
        await httpConfiguration().update(key, undefined, vscode.ConfigurationTarget.Global);
      }
    } finally {
      settingsSetByTest.clear();
      sandbox.restore();
      await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
    }
  });

  it('sends extension requests through the proxy once enabled, and direct after disabling', async () => {
    const proxy = await startProxy();
    await enableProxy(proxy);

    assert.deepEqual(await send(`http://${ORIGIN}/hello`), PROXY_ANSWERED);
    assert.deepEqual(proxy.requestsFor(ORIGIN), [
      { method: 'GET', url: `http://${ORIGIN}/hello`, host: ORIGIN, authorized: true }
    ]);

    await vscode.commands.executeCommand('proxyToggler.disable');
    await waitUntilRequestsGoDirect();

    assert.deepEqual(await send(`http://${ORIGIN}/hello`), NOT_RESOLVED);
    assert.equal(proxy.requestsFor(ORIGIN).length, 1, 'The proxy saw a request after disabling');
  });

  it('sends requests for hosts in the bypass list direct', async () => {
    const proxy = await startProxy();
    await enableProxy(proxy, ORIGIN);

    assert.deepEqual(await send(`http://${ORIGIN}/`), NOT_RESOLVED);
    // Other hosts still go through the proxy, so it was the bypass list that kept this one away.
    assert.deepEqual(await send('http://elsewhere.invalid/'), PROXY_ANSWERED);
    assert.deepEqual(proxy.requestsFor(ORIGIN), []);
  });

  it('sends HTTPS requests through a CONNECT tunnel', async () => {
    const proxy = await startProxy();
    await enableProxy(proxy);

    // The proxy refuses to open the tunnel, so the request fails; it only has to ask.
    const outcome = await send(`https://${ORIGIN}/`);

    assert.deepEqual(
      proxy.requestsFor(ORIGIN),
      [{ method: 'CONNECT', url: `${ORIGIN}:443`, host: ORIGIN, authorized: true }],
      `Request outcome: ${JSON.stringify(outcome)}`
    );
  });

  it('authenticates CONNECT with the credentials in the http.proxy URL', async () => {
    const credentials = { username: 'proxy-user', password: randomBytes(12).toString('hex') };
    const proxy = await startProxy({ credentials });
    // Written directly, because the extension refuses credentials in the proxy URL on purpose.
    await setUserSetting(
      'proxy',
      `http://${credentials.username}:${credentials.password}@127.0.0.1:${proxy.port}`
    );

    const outcome = await send(`https://${ORIGIN}/`);

    const requests = proxy.requestsFor(ORIGIN);
    assert.ok(
      requests.some((request) => request.method === 'CONNECT' && request.authorized),
      `Requests: ${JSON.stringify(requests)}. Request outcome: ${JSON.stringify(outcome)}`
    );
  });

  it("sends VS Code's own requests through the proxy", async () => {
    const proxy = await startProxy();
    await enableProxy(proxy);
    const reachedProxy = (): boolean =>
      proxy.requestsFor(MARKETPLACE).some((request) => request.method === 'CONNECT');

    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    for (let search = 1; !reachedProxy() && Date.now() < deadline; search++) {
      // VS Code's own processes apply the setting a moment after the extension host, so an early
      // search can still go direct. New text each time makes the view search again.
      await vscode.commands.executeCommand('workbench.extensions.search', `x${search}`);
      await delay(SEARCH_INTERVAL_MS);
    }

    assert.ok(
      reachedProxy(),
      `No CONNECT to ${MARKETPLACE}. The proxy saw: ${listRequests(proxy)}`
    );
  });
});
