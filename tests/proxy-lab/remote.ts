import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { describeRequest } from './requests';

// tests/run-proxy-lab-probe.ts runs this in the remote extension host of a window that Remote-SSH
// opened on the lab's SSH host. The runner copies it there, with a manifest that gives it Proxy
// Toggler's extension kind, `workspace`, and opens a folder that holds plan.json. The probe runs
// the plan's steps, then writes what it observed to results.json in the same folder; the runner
// judges that, the settings files, and the proxy logs.

export type RemoteStep =
  // Records http.proxy and http.useLocalProxyConfiguration as an extension reads them, and how a
  // request from this extension host to REQUEST_URL ends.
  | { observe: string }
  // Writes an http.* setting with ConfigurationTarget.Global, as Proxy Toggler does, then waits
  // for an http.proxy change event.
  | { label: string; update: 'proxy' | 'useLocalProxyConfiguration'; value: string | boolean }
  // Creates the file `ready` in the folder, which tells the runner to change something from
  // outside this window, then waits for an http.proxy change event.
  | { label: string; awaitOutsideChange: true };

export type RemotePlan = { steps: RemoteStep[] };

// The lab origin, which only a proxy reaches. The URL is fixed, so that a plan read from a file
// cannot send the probe's requests anywhere else.
const REQUEST_URL = 'http://origin.lab.test:8088/remote-probe';

// A settings write reaches the extension hosts within a second, so no event by then means none.
const EVENT_WAIT_MS = 10000;
// An outside change waits for the runner, which may first open a second window.
const OUTSIDE_CHANGE_WAIT_MS = 60000;

export async function run(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (folder === undefined) {
    throw new Error(
      'Open the folder that holds plan.json; run this through npm run proxy-lab:probe.'
    );
  }
  const plan = JSON.parse(await fs.readFile(path.join(folder, 'plan.json'), 'utf8')) as RemotePlan;

  const results: Record<string, string> = { remoteName: String(vscode.env.remoteName) };
  try {
    for (const step of plan.steps) {
      if ('observe' in step) {
        Object.assign(results, await observe(step.observe));
      } else if ('update' in step) {
        const change = nextProxyChange(EVENT_WAIT_MS);
        results[`${step.label}: update`] = await update(step.update, step.value);
        results[`${step.label}: event`] = await change;
      } else {
        const change = nextProxyChange(OUTSIDE_CHANGE_WAIT_MS);
        await fs.writeFile(path.join(folder, 'ready'), '');
        results[`${step.label}: event`] = await change;
      }
    }
  } catch (error: unknown) {
    results.error = String(error);
  }
  await fs.writeFile(path.join(folder, 'results.json'), JSON.stringify(results));
}

async function observe(label: string): Promise<Record<string, string>> {
  const http = vscode.workspace.getConfiguration('http');
  return {
    [`${label}: http.proxy`]: describeValue(http.get('proxy')),
    // inspect() also returns globalLocalValue and globalRemoteValue, which vscode.d.ts omits.
    [`${label}: inspect`]: JSON.stringify(http.inspect('proxy'), (key, value: unknown) =>
      key === 'key' ? undefined : value
    ),
    [`${label}: useLocalProxyConfiguration`]: describeValue(http.get('useLocalProxyConfiguration')),
    [`${label}: request`]: await describeRequest(REQUEST_URL)
  };
}

async function update(key: string, value: unknown): Promise<string> {
  try {
    await vscode.workspace
      .getConfiguration('http')
      .update(key, value, vscode.ConfigurationTarget.Global);
    return 'ok';
  } catch (error: unknown) {
    return `error ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Listens before the change is made, so the event cannot fire unseen.
function nextProxyChange(timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const subscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('http.proxy')) {
        clearTimeout(timer);
        subscription.dispose();
        resolve('http.proxy changed');
      }
    });
    const timer = setTimeout(() => {
      subscription.dispose();
      resolve(`none within ${timeoutMs / 1000} s`);
    }, timeoutMs);
  });
}

function describeValue(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}
