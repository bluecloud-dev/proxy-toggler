import * as http from 'node:http';
import * as https from 'node:https';

const REQUEST_TIMEOUT_MS = 8000;

// Requests a URL from the extension host, as an extension would, so the request takes whatever
// proxy that extension host applies. A failed request is a result here, so this resolves with
// "status <code>: <body>" or "error <code>" and never rejects.
export function describeRequest(url: string): Promise<string> {
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
