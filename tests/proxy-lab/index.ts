import * as fs from 'node:fs/promises';

import * as vscode from 'vscode';

import { describeRequest } from './requests';

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
