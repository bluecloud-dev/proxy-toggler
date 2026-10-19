import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';

import * as vscode from 'vscode';

const REQUEST_TIMEOUT_MS = 8000;
// VS Code sends its Marketplace requests within a second or two of the search.
const MARKETPLACE_WAIT_MS = 8000;

// tests/run-proxy-lab-probe.ts runs this inside VS Code, in a profile whose settings point at the
// proxy lab. It requests each URL in PROXY_LAB_URLS from the extension host, as an extension would,
// then searches the Marketplace so that VS Code sends requests of its own. It writes how each
// request ended to the file PROXY_LAB_RESULTS names; the runner judges that and the proxy logs.
export async function run(): Promise<void> {
  const resultsFile = process.env.PROXY_LAB_RESULTS;
  if (!resultsFile) {
    throw new Error('PROXY_LAB_RESULTS is not set; run this through npm run proxy-lab:probe.');
  }

  const results: Record<string, string> = {};
  for (const url of (process.env.PROXY_LAB_URLS ?? '').split(' ').filter(Boolean)) {
    results[url] = await describeRequest(url);
  }

  await vscode.commands.executeCommand('workbench.extensions.search', 'keymap');
  await new Promise((resolve) => setTimeout(resolve, MARKETPLACE_WAIT_MS));
  await fs.writeFile(resultsFile, JSON.stringify(results));
}

// A failed request is a result here, so this resolves with "status <code>: <body>" or
// "error <code>" and never rejects.
function describeRequest(url: string): Promise<string> {
  const get = url.startsWith('https:') ? https.get : http.get;
  return new Promise((resolve) => {
    const request = get(url, { timeout: REQUEST_TIMEOUT_MS }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => {
        resolve(`status ${String(response.statusCode)}: ${body.trim().slice(0, 120)}`);
      });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', (error: NodeJS.ErrnoException) => {
      resolve(`error ${error.code ?? error.message}`);
    });
  });
}
