import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { runTests, runVSCodeCommand, VSCodeCommandError } from '@vscode/test-electron';

import { DEFAULT_NO_PROXY, parseNoProxyList } from '../src/core/no-proxy';
import { makeTempDir, removeTempDir } from './temp-dir';
import { versionsToTest } from './vscode-versions';

// Probes how VS Code itself treats the proxy settings that Proxy Toggler writes, against the real
// proxies of dev/proxy-lab. Each check starts VS Code in a fresh profile whose settings.json holds
// the http.* settings, then compares what happened with the proxy logs. The expectations are the
// results recorded in TESTING.md, so a failing check means VS Code changed or the lab is broken.

const root = path.resolve(__dirname, '..');
const COMPOSE_FILE = path.join(root, 'dev', 'proxy-lab', 'compose.yaml');

// Declarative, published by Microsoft, and the same for every platform, so installing it costs a
// download of a few kilobytes.
const EXTENSION_ID = 'ms-vscode.notepadplusplus-keybindings';

const SQUID_OPEN = 'http://127.0.0.1:3128';
const SQUID_AUTH = 'http://127.0.0.1:3129';
const MITMPROXY = 'http://127.0.0.1:8080';
const PAC_ARGUMENT = '--proxy-pac-url=http://127.0.0.1:8000/proxy.pac';
const ORIGIN = 'http://origin.lab.test:8088';
// The bypass list Proxy Toggler writes when the user keeps the default.
const DEFAULT_BYPASS = parseNoProxyList(DEFAULT_NO_PROXY);

const MARKETPLACE_TUNNEL = /TCP_TUNNEL\/200 \d+ CONNECT marketplace\.visualstudio\.com:443 /;
const MARKETPLACE_DENIED = /TCP_DENIED\/407 \d+ CONNECT marketplace\.visualstudio\.com:443 /;
const MARKETPLACE_TLS_FAILED = /Client TLS handshake failed\..* marketplace\.visualstudio\.com/;
// mitmproxy logs a request only after the client accepted its certificate.
const MARKETPLACE_INTERCEPTED = /: (GET|POST) https:\/\/marketplace\.visualstudio\.com\//;
const PAC_FETCHED = /"GET \/proxy\.pac /;
const ORIGIN_REPLY = /^status 200: Proxy Toggler lab origin: /;
// mitmproxy presents only the certificate it forged, and Node.js knows no issuer for it.
const CERTIFICATE_REJECTED = /^error UNABLE_TO_VERIFY_LEAF_SIGNATURE$/;

const LOG_TIMEOUT_MS = 15000;
// How long a check waits before it concludes that a log line did not appear.
const ABSENCE_WAIT_MS = 3000;

type LabService = 'squid-open' | 'squid-auth' | 'mitmproxy' | 'pac';
type LogLine = { service: LabService; pattern: RegExp };
type HttpSettings = {
  'http.proxy'?: string;
  'http.proxyStrictSSL'?: boolean;
  'http.noProxy'?: string[];
};

type CheckBase = {
  name: string;
  settings: HttpSettings;
  args?: string[];
  logs: LogLine[];
  absentLogs?: LogLine[];
};
// `code --install-extension`: VS Code's own requests, sent by its Node.js request service.
type CliCheck = CheckBase & { client: 'cli'; installs: boolean };
// The desktop app: requests from the extension host, keyed by URL, and a Marketplace search.
type AppCheck = CheckBase & { client: 'app'; responses: Record<string, RegExp> };
type Check = CliCheck | AppCheck;

const CHECKS: readonly Check[] = [
  {
    name: 'CLI through squid-open',
    client: 'cli',
    settings: proxySettings(SQUID_OPEN, true),
    installs: true,
    logs: [{ service: 'squid-open', pattern: MARKETPLACE_TUNNEL }]
  },
  {
    // Proxy Toggler stores credentials but never applies them, so nothing answers the 407.
    name: 'CLI through squid-auth',
    client: 'cli',
    settings: proxySettings(SQUID_AUTH, true),
    installs: false,
    logs: [{ service: 'squid-auth', pattern: MARKETPLACE_DENIED }]
  },
  {
    name: 'CLI through mitmproxy, Strict SSL on',
    client: 'cli',
    settings: proxySettings(MITMPROXY, true),
    installs: false,
    logs: [{ service: 'mitmproxy', pattern: MARKETPLACE_TLS_FAILED }]
  },
  {
    name: 'CLI through mitmproxy, Strict SSL off',
    client: 'cli',
    settings: proxySettings(MITMPROXY, false),
    installs: true,
    logs: [{ service: 'mitmproxy', pattern: MARKETPLACE_INTERCEPTED }]
  },
  {
    name: 'CLI with only --proxy-pac-url',
    client: 'cli',
    settings: {},
    args: [PAC_ARGUMENT],
    installs: true,
    logs: [],
    absentLogs: [{ service: 'pac', pattern: PAC_FETCHED }]
  },
  {
    name: 'App through squid-open, with a bypass entry',
    client: 'app',
    settings: {
      ...proxySettings(SQUID_OPEN, true),
      'http.noProxy': [...DEFAULT_BYPASS, 'bypassed.lab.test']
    },
    responses: {
      [`${ORIGIN}/squid-open`]: ORIGIN_REPLY,
      // Lab names resolve only inside Docker, so a request that skips the proxy cannot resolve.
      'http://bypassed.lab.test:8088/': /^error (ENOTFOUND|EAI_AGAIN)$/
    },
    logs: [
      { service: 'squid-open', pattern: /GET http:\/\/origin\.lab\.test:8088\/squid-open / },
      { service: 'squid-open', pattern: MARKETPLACE_TUNNEL }
    ],
    absentLogs: [{ service: 'squid-open', pattern: /bypassed\.lab\.test/ }]
  },
  {
    name: 'App through mitmproxy, Strict SSL on',
    client: 'app',
    settings: proxySettings(MITMPROXY, true),
    responses: { 'https://marketplace.visualstudio.com/': CERTIFICATE_REJECTED },
    logs: [{ service: 'mitmproxy', pattern: MARKETPLACE_TLS_FAILED }],
    absentLogs: [{ service: 'mitmproxy', pattern: MARKETPLACE_INTERCEPTED }]
  },
  {
    // The desktop app checks certificates whatever http.proxyStrictSSL says.
    name: 'App through mitmproxy, Strict SSL off',
    client: 'app',
    settings: proxySettings(MITMPROXY, false),
    responses: { 'https://marketplace.visualstudio.com/': CERTIFICATE_REJECTED },
    logs: [{ service: 'mitmproxy', pattern: MARKETPLACE_TLS_FAILED }],
    absentLogs: [{ service: 'mitmproxy', pattern: MARKETPLACE_INTERCEPTED }]
  },
  {
    name: 'App with only --proxy-pac-url',
    client: 'app',
    settings: {},
    args: [PAC_ARGUMENT],
    responses: { [`${ORIGIN}/pac`]: ORIGIN_REPLY },
    logs: [
      { service: 'pac', pattern: PAC_FETCHED },
      { service: 'squid-open', pattern: /GET http:\/\/origin\.lab\.test:8088\/pac / },
      { service: 'squid-auth', pattern: MARKETPLACE_DENIED }
    ]
  }
];

const REQUIRED_SERVICES = ['squid-open', 'squid-auth', 'mitmproxy', 'pac', 'origin'];

type Outcome = { problems: string[]; evidence: string[] };
type Profile = { userDataDir: string; extensionsDir: string };

function proxySettings(proxy: string, strictSSL: boolean): HttpSettings {
  return { 'http.proxy': proxy, 'http.proxyStrictSSL': strictSSL, 'http.noProxy': DEFAULT_BYPASS };
}

async function main(): Promise<boolean> {
  // VS Code falls back to these variables when http.proxy is empty, and they would hide what the
  // settings do.
  for (const name of Object.keys(process.env)) {
    if (/^(https?|all|no)_proxy$/i.test(name)) {
      delete process.env[name];
    }
  }
  await assertLabIsRunning();

  let passed = true;
  for (const version of await versionsToTest()) {
    for (const check of CHECKS) {
      const { problems, evidence } = await runCheck(version, check);
      passed &&= problems.length === 0;
      // VS Code's own output fills the console, so each verdict stands out by its prefix.
      console.log(`${problems.length === 0 ? 'PASS' : 'FAIL'}  VS Code ${version}: ${check.name}`);
      for (const line of [...evidence, ...problems]) {
        console.log(`      ${line}`);
      }
    }
  }
  return passed;
}

async function assertLabIsRunning(): Promise<void> {
  const running = (await compose(['ps', '--services', '--status', 'running'])).split('\n');
  const missing = REQUIRED_SERVICES.filter((service) => !running.includes(service));
  if (missing.length > 0) {
    throw new Error(
      `The proxy lab is not running (${missing.join(', ')}). Start it with npm run proxy-lab:up.`
    );
  }
}

async function runCheck(version: string, check: Check): Promise<Outcome> {
  const temp = await makeTempDir('lab');
  const profile = {
    userDataDir: path.join(temp, 'user-data'),
    extensionsDir: path.join(temp, 'extensions')
  };
  const problems: string[] = [];
  const evidence: string[] = [];
  try {
    const settingsDir = path.join(profile.userDataDir, 'User');
    await fs.mkdir(settingsDir, { recursive: true });
    // Telemetry is off so that the proxy logs hold only the requests under test.
    const settings = { 'telemetry.telemetryLevel': 'off', ...check.settings };
    await fs.writeFile(path.join(settingsDir, 'settings.json'), JSON.stringify(settings, null, 2));
    const logStart = await logLengths([...check.logs, ...(check.absentLogs ?? [])]);

    if (check.client === 'cli') {
      const { installed, output } = await installExtension(version, profile, check.args ?? []);
      evidence.push(`code --install-extension: ${output}`);
      if (installed !== check.installs) {
        problems.push(`expected the install to ${check.installs ? 'succeed' : 'fail'}`);
      }
    } else {
      const responses = await runInVsCode(version, profile, check, temp);
      for (const [url, expected] of Object.entries(check.responses)) {
        const actual = responses[url] ?? 'no result';
        evidence.push(`extension host ${url}: ${actual}`);
        if (!expected.test(actual)) {
          problems.push(`expected ${url} to match ${String(expected)}`);
        }
      }
    }

    for (const { service, pattern } of check.logs) {
      const line = await waitForLogLine(service, pattern, logStart.get(service) ?? 0);
      if (line === undefined) {
        problems.push(`no ${service} log line matched ${String(pattern)}`);
      } else {
        evidence.push(`${service}: ${line.trim()}`);
      }
    }
    if (check.absentLogs) {
      await new Promise((resolve) => setTimeout(resolve, ABSENCE_WAIT_MS));
      for (const { service, pattern } of check.absentLogs) {
        const lines = (await serviceLog(service)).slice(logStart.get(service) ?? 0);
        const line = lines.find((candidate) => pattern.test(candidate));
        if (line !== undefined) {
          problems.push(`unexpected ${service} log line: ${line.trim()}`);
        }
      }
    }
  } finally {
    await removeTempDir(temp);
  }
  return { problems, evidence };
}

async function installExtension(
  version: string,
  profile: Profile,
  args: string[]
): Promise<{ installed: boolean; output: string }> {
  const commandArgs = [
    '--install-extension',
    EXTENSION_ID,
    `--user-data-dir=${profile.userDataDir}`,
    `--extensions-dir=${profile.extensionsDir}`,
    ...args
  ];
  try {
    const { stdout } = await runVSCodeCommand(commandArgs, { version });
    return { installed: true, output: meaningfulLines(stdout).at(-1) ?? '(no output)' };
  } catch (error: unknown) {
    if (!(error instanceof VSCodeCommandError)) {
      throw error;
    }
    // The cause comes first on stderr, before the summary line. Some releases print it on stdout.
    const output = meaningfulLines(error.stderr)[0] ?? meaningfulLines(error.stdout).at(-1);
    return { installed: false, output: output ?? '(no output)' };
  }
}

// Node.js deprecation warnings from VS Code's own code say nothing about the proxy.
function meaningfulLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('(node:') && !line.startsWith('(Use '));
}

async function runInVsCode(
  version: string,
  profile: Profile,
  check: AppCheck,
  temp: string
): Promise<Record<string, string>> {
  const resultsFile = path.join(temp, 'results.json');
  // VS Code loads extension tests only in a development host; the packaged tests' empty
  // extension serves as one.
  await runTests({
    version,
    extensionDevelopmentPath: path.join(root, 'tests', 'packaged', 'host'),
    extensionTestsPath: path.join(root, 'out', 'tests', 'proxy-lab', 'index.js'),
    launchArgs: [
      '--user-data-dir',
      profile.userDataDir,
      '--extensions-dir',
      profile.extensionsDir,
      ...(check.args ?? [])
    ],
    extensionTestsEnv: {
      PROXY_LAB_URLS: Object.keys(check.responses).join(' '),
      PROXY_LAB_RESULTS: resultsFile
    }
  });
  return JSON.parse(await fs.readFile(resultsFile, 'utf8')) as Record<string, string>;
}

async function logLengths(lines: LogLine[]): Promise<Map<LabService, number>> {
  const lengths = new Map<LabService, number>();
  for (const { service } of lines) {
    if (!lengths.has(service)) {
      lengths.set(service, (await serviceLog(service)).length);
    }
  }
  return lengths;
}

// Squid logs a CONNECT tunnel when it closes, and the lines reach `docker compose logs` about a
// second later, so a line can appear some time after the client is done.
async function waitForLogLine(
  service: LabService,
  pattern: RegExp,
  from: number
): Promise<string | undefined> {
  const deadline = Date.now() + LOG_TIMEOUT_MS;
  for (;;) {
    const line = (await serviceLog(service))
      .slice(from)
      .find((candidate) => pattern.test(candidate));
    if (line !== undefined || Date.now() >= deadline) {
      return line;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// Checks remember how many lines a log had and read only the lines after them, so the count must
// not include the empty string after the final newline.
async function serviceLog(service: LabService): Promise<string[]> {
  const output = await compose(['logs', '--no-log-prefix', service]);
  return output.split('\n').filter((line) => line.length > 0);
}

async function compose(args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  return stdout;
}

// runVSCodeCommand leaves VS Code's output pipes open, which can keep Node alive on Windows, so the
// process exits explicitly.
main().then(
  (passed) => process.exit(passed ? 0 : 1),
  (error: unknown) => {
    console.error('The proxy lab probe failed to run.', error);
    process.exit(1);
  }
);
