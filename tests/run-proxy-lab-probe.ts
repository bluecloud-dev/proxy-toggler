import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { runTests, runVSCodeCommand, VSCodeCommandError } from '@vscode/test-electron';

import type { RemotePlan } from './proxy-lab/remote';
import { makeTempDir, removeTempDir } from './temp-dir';
import { versionsToTest } from './vscode-versions';

// Probes how VS Code itself treats the proxy settings that Proxy Toggler writes, against the real
// proxies of dev/proxy-lab. Each check starts VS Code in a fresh profile whose settings.json holds
// the http.* settings, then compares what happened with the proxy logs. The expectations are the
// results recorded in TESTING.md, so a failing check means VS Code changed or the lab is broken.
// The remote checks open a Remote-SSH window on the lab's SSH host and run tests/proxy-lab/remote.ts
// in its remote extension host. `npm run proxy-lab:probe -- <text>` runs only the checks whose name
// contains the text.

const root = path.resolve(__dirname, '..');
const COMPOSE_FILE = path.join(root, 'dev', 'proxy-lab', 'compose.yaml');

// Declarative, published by Microsoft, and the same for every platform, so installing it costs a
// download of a few kilobytes.
const EXTENSION_ID = 'ms-vscode.notepadplusplus-keybindings';
const REMOTE_SSH_ID = 'ms-vscode-remote.remote-ssh';

const SQUID_OPEN = 'http://127.0.0.1:3128';
const SQUID_AUTH = 'http://127.0.0.1:3129';
const MITMPROXY = 'http://127.0.0.1:8080';
const PAC_ARGUMENT = '--proxy-pac-url=http://127.0.0.1:8000/proxy.pac';
const ORIGIN = 'http://origin.lab.test:8088';
const MARKETPLACE = 'https://marketplace.visualstudio.com/';
// The bypass list 0.1.x saved when the user kept the default.
const DEFAULT_BYPASS = ['localhost', '127.0.0.1'];

// The SSH host reaches the proxies by service name, on the lab's remote network.
const REMOTE_SQUID_OPEN = 'http://squid-open:3128';
const REMOTE_SQUID_AUTH = 'http://squid-auth:3128';
// The checks for remote-window support start at the release that support will need: VS Code
// 1.97.0, the first with http.useLocalProxyConfiguration.
const REMOTE_SINCE = '1.97.0';
const SSH_HOST = 'proxy-lab';
const REMOTE_AUTHORITY = `ssh-remote+${SSH_HOST}`;
const REMOTE_PROBE = '/home/lab/probe';
const MACHINE_SETTINGS = '/home/lab/.vscode-server/data/Machine/settings.json';

const MARKETPLACE_TUNNEL = /TCP_TUNNEL\/200 \d+ CONNECT marketplace\.visualstudio\.com:443 /;
const MARKETPLACE_DENIED = /TCP_DENIED\/407 \d+ CONNECT marketplace\.visualstudio\.com:443 /;
const MARKETPLACE_TLS_FAILED = /Client TLS handshake failed\..* marketplace\.visualstudio\.com/;
// mitmproxy logs a request only after the client accepted its certificate.
const MARKETPLACE_INTERCEPTED = /: (GET|POST) https:\/\/marketplace\.visualstudio\.com\//;
const PAC_FETCHED = /"GET \/proxy\.pac /;
// tests/proxy-lab/remote.ts requests this URL each time it observes.
const REMOTE_PROBE_REQUEST = /GET http:\/\/origin\.lab\.test:8088\/remote-probe /;
const ORIGIN_REPLY = /^status 200: Proxy Toggler lab origin: /;
// Lab names resolve only inside Docker, so a request that skips the proxy cannot resolve.
const DIRECT = /^error (ENOTFOUND|EAI_AGAIN)$/;
// Nothing listens on the SSH host's own 127.0.0.1:3128, so a remote request that takes the local
// proxy address fails there.
const LOCAL_PROXY_ON_REMOTE = /^error .*PROXY 127\.0\.0\.1:3128$/;
// mitmproxy presents only the certificate it forged, and Node.js knows no issuer for it.
const CERTIFICATE_REJECTED = /^error UNABLE_TO_VERIFY_LEAF_SIGNATURE$/;

const LOG_TIMEOUT_MS = 15000;
// How long a check waits before it concludes that a log line did not appear.
const ABSENCE_WAIT_MS = 3000;
// A remote window that has not closed by then waits on something, such as a Remote-SSH prompt.
const WINDOW_TIMEOUT_MS = 180000;
const READY_TIMEOUT_MS = 120000;
// VS Code exits within seconds once pkill stops it.
const KILL_WAIT_MS = 30000;

type LabService = 'squid-open' | 'squid-auth' | 'mitmproxy' | 'socks5' | 'pac';
type LogLine = { service: LabService; pattern: RegExp };
type HttpSettings = {
  'http.proxy'?: string;
  'http.proxyStrictSSL'?: boolean;
  'http.noProxy'?: string[];
};
type MachineSettings = HttpSettings & { 'http.useLocalProxyConfiguration'?: boolean };

type CheckBase = {
  name: string;
  // The local user settings.
  settings: HttpSettings;
  args?: string[];
  logs: LogLine[];
  absentLogs?: LogLine[];
  // The oldest release to check, when engines.vscode allows an older one.
  since?: string;
};
// `code --install-extension`: VS Code's own requests, sent by its Node.js request service.
// `onVersion` gives the outcome on releases that behave otherwise.
type CliCheck = CheckBase & {
  client: 'cli';
  installs: boolean;
  onVersion?: Record<string, { installs: boolean; logs: LogLine[] }>;
};
// The desktop app: requests from the extension host, keyed by URL, and a Marketplace search.
// Chromium's net log records how the window's Marketplace requests ended, and `windowMarketplace`
// is what they must show.
// `update` writes settings while VS Code runs, as Proxy Toggler does, then sends its own requests
// and searches again. `env` adds variables to VS Code's environment.
type AppCheck = CheckBase & {
  client: 'app';
  responses: Record<string, RegExp>;
  windowMarketplace?: RegExp;
  update?: { settings: Record<string, unknown>; responses: Record<string, RegExp> };
  env?: Record<string, string>;
};
// A Remote-SSH window on the lab's SSH host that runs a plan of tests/proxy-lab/remote.ts. Once the
// plan waits for an outside change, `localChange` replaces http.* settings in the window's local
// settings.json, and `secondWindow` opens another window on the same host, in its own profile.
type SshCheck = CheckBase & {
  client: 'ssh';
  // The SSH host's Machine/settings.json when the window opens.
  machineSettings: MachineSettings;
  plan: RemotePlan;
  localChange?: HttpSettings;
  secondWindow?: RemotePlan;
  // What the windows recorded, and the http.* values in both settings files afterwards.
  observations: Record<string, RegExp>;
};
type Check = CliCheck | AppCheck | SshCheck;

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
    logs: [{ service: 'mitmproxy', pattern: MARKETPLACE_INTERCEPTED }],
    // VS Code 1.97.0's CLI checks the certificate whatever http.proxyStrictSSL says.
    onVersion: {
      '1.97.0': {
        installs: false,
        logs: [{ service: 'mitmproxy', pattern: MARKETPLACE_TLS_FAILED }]
      }
    }
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
      'http://bypassed.lab.test:8088/': DIRECT
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
    responses: { [MARKETPLACE]: CERTIFICATE_REJECTED },
    logs: [{ service: 'mitmproxy', pattern: MARKETPLACE_TLS_FAILED }],
    absentLogs: [{ service: 'mitmproxy', pattern: MARKETPLACE_INTERCEPTED }]
  },
  {
    // The desktop app checks certificates whatever http.proxyStrictSSL says.
    name: 'App through mitmproxy, Strict SSL off',
    client: 'app',
    settings: proxySettings(MITMPROXY, false),
    responses: { [MARKETPLACE]: CERTIFICATE_REJECTED },
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
  },
  {
    // Chromium has no socks5h scheme, while the extension host reads it as SOCKS5.
    name: 'App with a socks5h:// proxy',
    client: 'app',
    since: REMOTE_SINCE,
    settings: { 'http.proxy': 'socks5h://127.0.0.1:1080' },
    responses: { [`${ORIGIN}/socks5h`]: ORIGIN_REPLY },
    windowMarketplace: /^ERR_NO_SUPPORTED_PROXIES ×\d+$/,
    logs: [{ service: 'socks5', pattern: /server connect origin\.lab\.test:8088 / }]
  },
  {
    name: 'SSH window with http.proxy set only locally',
    client: 'ssh',
    since: REMOTE_SINCE,
    settings: { 'http.proxy': SQUID_OPEN },
    machineSettings: {},
    plan: {
      steps: [
        { observe: 'initial' },
        { label: 'local change', awaitOutsideChange: true },
        { observe: 'after local change' }
      ]
    },
    localChange: { 'http.proxy': SQUID_AUTH },
    observations: {
      remoteName: /^ssh-remote$/,
      // Although http.* have machine scope, the local value usually reaches the window at
      // start-up, and the remote extension host then uses it. On 1.142.0 it did not when the
      // connection installed the VS Code server, so either outcome passes.
      'initial: http.proxy': oneOf(recorded(SQUID_OPEN), recorded('')),
      'initial: request': oneOf(LOCAL_PROXY_ON_REMOTE, DIRECT),
      // A change to the local value is announced, but the remote side then sees no value at all.
      'local change: event': /^http\.proxy changed$/,
      'after local change: http.proxy': recorded(''),
      'after local change: request': DIRECT
    },
    logs: []
  },
  {
    name: 'SSH window, Global write while the remote file holds a stale http.proxy',
    client: 'ssh',
    since: REMOTE_SINCE,
    settings: { 'http.proxy': SQUID_OPEN },
    machineSettings: { 'http.useLocalProxyConfiguration': true, 'http.proxy': REMOTE_SQUID_AUTH },
    plan: {
      steps: [
        { observe: 'before' },
        { label: 'write', update: 'proxy', value: REMOTE_SQUID_OPEN },
        { observe: 'after' }
      ]
    },
    observations: {
      'before: http.proxy': recorded(SQUID_OPEN),
      'write: update': /^ok$/,
      // The write replaces the stale remote value, which application scope ignores, so the
      // value in effect stays the local one.
      'remote Machine/settings.json http.proxy': recorded(REMOTE_SQUID_OPEN),
      'local settings.json http.proxy': recorded(SQUID_OPEN),
      'after: http.proxy': recorded(SQUID_OPEN),
      'after: request': LOCAL_PROXY_ON_REMOTE
    },
    logs: []
  },
  {
    name: 'SSH window, http.useLocalProxyConfiguration changed while open',
    client: 'ssh',
    since: REMOTE_SINCE,
    settings: { 'http.proxy': SQUID_OPEN },
    machineSettings: { 'http.proxy': REMOTE_SQUID_OPEN },
    plan: {
      steps: [
        { observe: 'before' },
        { label: 'on', update: 'useLocalProxyConfiguration', value: true },
        { observe: 'on' },
        { label: 'off', update: 'useLocalProxyConfiguration', value: false },
        { observe: 'off' }
      ]
    },
    // Both changes apply to the remote extension host without a reload.
    observations: {
      'before: http.proxy': recorded(REMOTE_SQUID_OPEN),
      'before: request': ORIGIN_REPLY,
      'on: update': /^ok$/,
      'on: event': /^http\.proxy changed$/,
      'on: http.proxy': recorded(SQUID_OPEN),
      'on: request': LOCAL_PROXY_ON_REMOTE,
      'off: update': /^ok$/,
      'off: event': /^http\.proxy changed$/,
      'off: http.proxy': recorded(REMOTE_SQUID_OPEN),
      'off: request': ORIGIN_REPLY,
      'remote Machine/settings.json http.useLocalProxyConfiguration': recorded(false)
    },
    logs: [{ service: 'squid-open', pattern: REMOTE_PROBE_REQUEST }]
  },
  {
    // Proxy Toggler pins every remote machine it manages: turning the proxy off there writes an
    // empty http.proxy instead of removing it, so that the local value cannot leak in (check 1).
    name: 'SSH window whose remote settings pin an empty http.proxy',
    client: 'ssh',
    since: REMOTE_SINCE,
    settings: { 'http.proxy': SQUID_OPEN },
    machineSettings: { 'http.proxy': '' },
    plan: { steps: [{ observe: 'initial' }] },
    observations: {
      remoteName: /^ssh-remote$/,
      'initial: http.proxy': recorded(''),
      'initial: request': DIRECT,
      'remote Machine/settings.json http.proxy': recorded('')
    },
    logs: []
  },
  {
    name: 'Two SSH windows, the second writes the remote http.proxy',
    client: 'ssh',
    since: REMOTE_SINCE,
    settings: {},
    machineSettings: {},
    plan: {
      steps: [
        { observe: 'before' },
        { label: 'other window', awaitOutsideChange: true },
        { observe: 'after' }
      ]
    },
    secondWindow: {
      steps: [{ label: 'write', update: 'proxy', value: REMOTE_SQUID_OPEN }]
    },
    observations: {
      'before: http.proxy': recorded(''),
      'second window, write: update': /^ok$/,
      'remote Machine/settings.json http.proxy': recorded(REMOTE_SQUID_OPEN),
      'other window: event': /^http\.proxy changed$/,
      'after: http.proxy': recorded(REMOTE_SQUID_OPEN),
      'after: request': ORIGIN_REPLY
    },
    logs: [{ service: 'squid-open', pattern: REMOTE_PROBE_REQUEST }]
  }
];

// What Off does: Proxy Toggler removes the three settings while VS Code runs. `npm run
// proxy-lab:probe -- "App, Off:"` runs only these checks.
const CLEARED = { 'http.proxy': null, 'http.proxyStrictSSL': null, 'http.noProxy': null };
// A candidate for a Direct entry: no proxy, and every host bypassed.
const DIRECT_CANDIDATE = { 'http.proxy': '', 'http.noProxy': ['*'] };

const OFF_CHECKS: readonly Check[] = [
  {
    name: 'App, Off: settings removed while running, with --proxy-pac-url',
    client: 'app',
    settings: proxySettings(SQUID_OPEN, true),
    args: [PAC_ARGUMENT],
    responses: { [`${ORIGIN}/off-before`]: ORIGIN_REPLY },
    update: { settings: CLEARED, responses: { [`${ORIGIN}/off-after`]: DIRECT } },
    logs: [{ service: 'squid-open', pattern: /GET http:\/\/origin\.lab\.test:8088\/off-before / }],
    absentLogs: [
      { service: 'squid-open', pattern: /\/off-after / },
      { service: 'squid-auth', pattern: MARKETPLACE_DENIED }
    ]
  },
  {
    name: 'App, Off: settings removed while running, with HTTP_PROXY and HTTPS_PROXY',
    client: 'app',
    settings: proxySettings(SQUID_OPEN, true),
    env: { HTTP_PROXY: SQUID_AUTH, HTTPS_PROXY: SQUID_AUTH },
    responses: { [`${ORIGIN}/env-before`]: ORIGIN_REPLY },
    update: { settings: CLEARED, responses: { [`${ORIGIN}/env-after`]: /^status 407: / } },
    logs: [
      { service: 'squid-open', pattern: /GET http:\/\/origin\.lab\.test:8088\/env-before / },
      {
        service: 'squid-auth',
        pattern: /TCP_DENIED\/407 \d+ GET http:\/\/origin\.lab\.test:8088\/env-after /
      },
      // The window follows the variables too once the settings are gone.
      { service: 'squid-auth', pattern: MARKETPLACE_DENIED }
    ]
  },
  {
    name: 'App, Off: Direct candidate at start-up, with --proxy-pac-url',
    client: 'app',
    settings: DIRECT_CANDIDATE,
    args: [PAC_ARGUMENT],
    responses: { [`${ORIGIN}/direct-start`]: DIRECT },
    logs: [],
    absentLogs: [
      { service: 'squid-open', pattern: /\/direct-start / },
      { service: 'squid-auth', pattern: MARKETPLACE_DENIED }
    ]
  },
  {
    name: 'App, Off: Direct candidate while running, with --proxy-pac-url',
    client: 'app',
    settings: proxySettings(SQUID_OPEN, true),
    args: [PAC_ARGUMENT],
    responses: { [`${ORIGIN}/direct-before`]: ORIGIN_REPLY },
    update: { settings: DIRECT_CANDIDATE, responses: { [`${ORIGIN}/direct-after`]: DIRECT } },
    logs: [
      { service: 'squid-open', pattern: /GET http:\/\/origin\.lab\.test:8088\/direct-before / }
    ],
    absentLogs: [
      { service: 'squid-open', pattern: /\/direct-after / },
      { service: 'squid-auth', pattern: MARKETPLACE_DENIED }
    ]
  }
];

const REQUIRED_SERVICES = ['squid-open', 'squid-auth', 'mitmproxy', 'socks5', 'pac', 'origin'];
const REQUIRED_SSH_SERVICES = [...REQUIRED_SERVICES, 'ssh-host'];

type Outcome = { problems: string[]; evidence: string[] };
type Profile = { userDataDir: string; extensionsDir: string };
// What the remote checks share: an SSH configuration for Remote-SSH, and per VS Code version an
// extensions directory with Remote-SSH installed.
type SshLab = { configFile: string; extensionsDirs: Map<string, Promise<string>>; dir: string };

function proxySettings(proxy: string, strictSSL: boolean): HttpSettings {
  return { 'http.proxy': proxy, 'http.proxyStrictSSL': strictSSL, 'http.noProxy': DEFAULT_BYPASS };
}

// Matches a setting value as the remote probe records it: as JSON, so a string keeps its quotes.
function recorded(value: string | boolean): RegExp {
  return new RegExp(`^${JSON.stringify(value).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`);
}

function oneOf(...patterns: RegExp[]): RegExp {
  return new RegExp(patterns.map((pattern) => `(?:${pattern.source})`).join('|'));
}

async function main(): Promise<boolean> {
  // VS Code falls back to these variables when http.proxy is empty, and they would hide what the
  // settings do.
  for (const name of Object.keys(process.env)) {
    if (/^(https?|all|no)_proxy$/i.test(name)) {
      delete process.env[name];
    }
  }
  const filter = process.argv[2] ?? '';
  const checks = [...CHECKS, ...OFF_CHECKS].filter((check) => check.name.includes(filter));
  // Running nothing would look like a pass.
  if (checks.length === 0) {
    throw new Error(`No check name contains "${filter}".`);
  }
  await assertLabIsRunning(
    checks.some((check) => check.client === 'ssh') ? REQUIRED_SSH_SERVICES : REQUIRED_SERVICES
  );

  // A check with `since` runs on that release instead of an older engines.vscode minimum.
  const runs = (await versionsToTest()).flatMap((version) =>
    checks.map((check) => {
      const run = atLeast(version, check.since);
      return { version: run, check: forVersion(check, run) };
    })
  );
  let ssh: Promise<SshLab> | undefined;
  const sshLab = (): Promise<SshLab> => (ssh ??= prepareSshLab());
  let passed = true;
  try {
    for (const { version, check } of runs) {
      const { problems, evidence } = await runCheck(version, check, sshLab);
      passed &&= problems.length === 0;
      // VS Code's own output fills the console, so each verdict stands out by its prefix.
      console.log(`${problems.length === 0 ? 'PASS' : 'FAIL'}  VS Code ${version}: ${check.name}`);
      for (const line of [...evidence, ...problems]) {
        console.log(`      ${line}`);
      }
    }
  } finally {
    // A preparation that failed has removed its directory already.
    const lab = await ssh?.catch(() => undefined);
    if (lab) {
      await removeTempDir(lab.dir);
    }
  }
  return passed;
}

// The check as it applies to that release.
function forVersion(check: Check, version: string): Check {
  if (check.client !== 'cli') {
    return check;
  }
  const outcome = check.onVersion?.[version];
  return outcome ? { ...check, ...outcome } : check;
}

function atLeast(version: string, since: string | undefined): string {
  if (since === undefined || version === 'stable') {
    return version;
  }
  return version.localeCompare(since, undefined, { numeric: true }) >= 0 ? version : since;
}

async function assertLabIsRunning(services: string[]): Promise<void> {
  const running = (await compose(['ps', '--services', '--status', 'running'])).split('\n');
  const missing = services.filter((service) => !running.includes(service));
  if (missing.length > 0) {
    throw new Error(
      `The proxy lab is not running (${missing.join(', ')}). Start it with npm run proxy-lab:up.`
    );
  }
}

async function runCheck(
  version: string,
  check: Check,
  sshLab: () => Promise<SshLab>
): Promise<Outcome> {
  const temp = await makeTempDir('lab');
  const profile = {
    userDataDir: path.join(temp, 'user-data'),
    extensionsDir: path.join(temp, 'extensions')
  };
  const problems: string[] = [];
  const evidence: string[] = [];
  try {
    // Telemetry is off so that the proxy logs hold only the requests under test.
    const settings = { 'telemetry.telemetryLevel': 'off', ...check.settings };
    await writeUserSettings(profile.userDataDir, settings);
    const logStart = await logLengths([...check.logs, ...(check.absentLogs ?? [])]);

    if (check.client === 'cli') {
      const { installed, output } = await installExtension(version, profile, check.args ?? []);
      evidence.push(`code --install-extension: ${output}`);
      if (installed !== check.installs) {
        problems.push(`expected the install to ${check.installs ? 'succeed' : 'fail'}`);
      }
    } else if (check.client === 'app') {
      const responses = await runInVsCode(version, profile, check, temp);
      const expectedResponses = { ...check.responses, ...check.update?.responses };
      for (const [url, expected] of Object.entries(expectedResponses)) {
        const actual = responses[url] ?? 'no result';
        evidence.push(`extension host ${url}: ${actual}`);
        if (!expected.test(actual)) {
          problems.push(`expected ${url} to match ${String(expected)}`);
        }
      }
      const windowMarketplace = await windowRequests(path.join(temp, 'net-log.json'), MARKETPLACE);
      evidence.push(`window ${MARKETPLACE}: ${windowMarketplace}`);
      if (check.windowMarketplace && !check.windowMarketplace.test(windowMarketplace)) {
        problems.push(`expected the window's requests to match ${String(check.windowMarketplace)}`);
      }
    } else {
      const observed = await runInSshWindows(version, check, await sshLab(), temp, settings);
      problems.push(...observed.problems);
      for (const [key, actual] of Object.entries(observed.observations)) {
        evidence.push(`${key}: ${actual}`);
      }
      for (const [key, expected] of Object.entries(check.observations)) {
        if (!expected.test(observed.observations[key] ?? 'no result')) {
          problems.push(`expected ${key} to match ${String(expected)}`);
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

async function writeUserSettings(userDataDir: string, settings: object): Promise<string> {
  const settingsDir = path.join(userDataDir, 'User');
  await fs.mkdir(settingsDir, { recursive: true });
  const file = path.join(settingsDir, 'settings.json');
  await fs.writeFile(file, JSON.stringify(settings, null, 2));
  return file;
}

async function installExtension(
  version: string,
  profile: Profile,
  args: string[],
  extensionId = EXTENSION_ID
): Promise<{ installed: boolean; output: string }> {
  const commandArgs = [
    '--install-extension',
    extensionId,
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
  // VS Code passes switches it does not know to Chromium, which then logs every request.
  const netLog = [`--log-net-log=${path.join(temp, 'net-log.json')}`];
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
      ...netLog,
      ...(check.args ?? [])
    ],
    extensionTestsEnv: {
      ...check.env,
      PROXY_LAB_URLS: Object.keys(check.responses).join(' '),
      PROXY_LAB_RESULTS: resultsFile,
      ...(check.update && {
        PROXY_LAB_UPDATE: JSON.stringify(check.update.settings),
        PROXY_LAB_UPDATE_URLS: Object.keys(check.update.responses).join(' ')
      })
    }
  });
  return JSON.parse(await fs.readFile(resultsFile, 'utf8')) as Record<string, string>;
}

type NetLog = {
  constants: {
    logEventTypes: Record<string, number>;
    logEventPhase: Record<string, number>;
    logSourceType: Record<string, number>;
    netError: Record<string, number>;
  };
  events: {
    phase: number;
    type: number;
    source: { id: number; type: number };
    params?: { url?: string; net_error?: number };
  }[];
};

// Counts how the window's requests to URLs under `prefix` ended, from Chromium's net log, for
// example "ERR_NO_SUPPORTED_PROXIES ×4". Errors are the names Chromium gives them.
async function windowRequests(netLogFile: string, prefix: string): Promise<string> {
  let log: NetLog;
  try {
    log = JSON.parse(await fs.readFile(netLogFile, 'utf8')) as NetLog;
  } catch {
    return 'no readable net log';
  }
  const { logEventTypes, logEventPhase, logSourceType, netError } = log.constants;
  const errorNames = new Map(Object.entries(netError).map(([name, code]) => [code, name]));
  const requests = new Map<number, { url: string; outcome: string }>();
  for (const { phase, type, source, params } of log.events) {
    if (source.type !== logSourceType.URL_REQUEST || type !== logEventTypes.REQUEST_ALIVE) {
      continue;
    }
    if (phase === logEventPhase.PHASE_BEGIN && params?.url?.startsWith(prefix)) {
      requests.set(source.id, { url: params.url, outcome: 'unfinished' });
    }
    const request = requests.get(source.id);
    if (phase === logEventPhase.PHASE_END && request) {
      const error = params?.net_error;
      request.outcome = error === undefined ? 'OK' : (errorNames.get(error) ?? String(error));
    }
  }
  const counts = new Map<string, number>();
  for (const { outcome } of requests.values()) {
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return 'no requests';
  }
  return [...counts].map(([outcome, count]) => `${outcome} ×${count}`).join(', ');
}

// Copies the lab's SSH key out of the container for Remote-SSH, and the remote probe into it.
async function prepareSshLab(): Promise<SshLab> {
  const dir = await makeTempDir('ssh');
  try {
    const keyFile = path.join(dir, 'id_ed25519');
    await compose(['cp', 'ssh-host:/run/ssh-lab/id_ed25519', keyFile]);
    const configFile = path.join(dir, 'config');
    await fs.writeFile(
      configFile,
      [
        `Host ${SSH_HOST}`,
        '  HostName 127.0.0.1',
        '  Port 2222',
        '  User lab',
        `  IdentityFile "${keyFile}"`,
        '  IdentitiesOnly yes',
        // The host key is new each time the lab starts.
        '  StrictHostKeyChecking no',
        '  UserKnownHostsFile /dev/null',
        '  LogLevel ERROR',
        ''
      ].join('\n')
    );

    // A manifest with `main` and no `extensionKind` has the kind `workspace`, as Proxy Toggler's has.
    const manifest = {
      name: 'proxy-lab-remote-probe',
      displayName: 'Proxy Toggler remote probe',
      version: '0.0.0',
      publisher: 'proxy-toggler-tests',
      private: true,
      engines: { vscode: `^${REMOTE_SINCE}` },
      main: './remote.js'
    };
    await sshHost(['rm', '-rf', REMOTE_PROBE]);
    await writeRemoteFile(`${REMOTE_PROBE}/package.json`, JSON.stringify(manifest, null, 2));
    for (const file of ['remote.js', 'requests.js']) {
      const compiled = await fs.readFile(
        path.join(root, 'out', 'tests', 'proxy-lab', file),
        'utf8'
      );
      await writeRemoteFile(`${REMOTE_PROBE}/${file}`, compiled);
    }
    return { configFile, extensionsDirs: new Map(), dir };
  } catch (error: unknown) {
    await removeTempDir(dir);
    throw error;
  }
}

function remoteSshExtensions(ssh: SshLab, version: string): Promise<string> {
  let extensionsDir = ssh.extensionsDirs.get(version);
  if (!extensionsDir) {
    extensionsDir = (async () => {
      const profile = {
        userDataDir: path.join(ssh.dir, `install-${version}`),
        extensionsDir: path.join(ssh.dir, `extensions-${version}`)
      };
      const { installed, output } = await installExtension(version, profile, [], REMOTE_SSH_ID);
      if (!installed) {
        throw new Error(`Could not install Remote-SSH in VS Code ${version}: ${output}`);
      }
      return profile.extensionsDir;
    })();
    ssh.extensionsDirs.set(version, extensionsDir);
  }
  return extensionsDir;
}

async function runInSshWindows(
  version: string,
  check: SshCheck,
  ssh: SshLab,
  temp: string,
  settings: object
): Promise<{ observations: Record<string, string>; problems: string[] }> {
  const extensionsDir = await remoteSshExtensions(ssh, version);
  const windowSettings = {
    ...settings,
    'remote.SSH.configFile': ssh.configFile,
    // Remote-SSH asks for the platform of a host it does not know.
    'remote.SSH.remotePlatform': { [SSH_HOST]: 'linux' },
    // Extension updates would add Marketplace traffic in the middle of a check.
    'extensions.autoCheckUpdates': false,
    'extensions.autoUpdate': false
  };
  const first = { folder: '/home/lab/window-1', userDataDir: path.join(temp, 'window-1') };
  const second = { folder: '/home/lab/window-2', userDataDir: path.join(temp, 'window-2') };

  // Each check starts a new VS Code server, so nothing carries over from the check before.
  await sshHost(['pkill', '-KILL', '-u', 'lab'], 'root').catch(() => undefined);
  await sshHost(['rm', '-rf', MACHINE_SETTINGS, first.folder, second.folder]);
  if (Object.keys(check.machineSettings).length > 0) {
    await writeRemoteFile(MACHINE_SETTINGS, JSON.stringify(check.machineSettings, null, 2));
  }
  await writeRemoteFile(`${first.folder}/plan.json`, JSON.stringify(check.plan));
  const localSettingsFile = await writeUserSettings(first.userDataDir, windowSettings);
  if (check.secondWindow) {
    await writeRemoteFile(`${second.folder}/plan.json`, JSON.stringify(check.secondWindow));
    await writeUserSettings(second.userDataDir, windowSettings);
  }

  const problems: string[] = [];
  const firstClosed = openSshWindow(version, first, extensionsDir);
  if (check.localChange || check.secondWindow) {
    if (await waitForRemoteFile(`${first.folder}/ready`, firstClosed)) {
      if (check.localChange) {
        await writeUserSettings(first.userDataDir, { ...windowSettings, ...check.localChange });
      }
      if (check.secondWindow) {
        problems.push(...(await openSshWindow(version, second, extensionsDir)));
      }
    } else {
      problems.push('the window never became ready for the outside change');
    }
  }
  problems.push(...(await firstClosed));

  const observations = await readRemoteJson(`${first.folder}/results.json`);
  if (check.secondWindow) {
    for (const [key, value] of Object.entries(
      await readRemoteJson(`${second.folder}/results.json`)
    )) {
      observations[`second window, ${key}`] = value;
    }
  }
  const localSettings = JSON.parse(await fs.readFile(localSettingsFile, 'utf8')) as object;
  const machineSettings = await readRemoteJson(MACHINE_SETTINGS);
  for (const key of ['http.proxy', 'http.useLocalProxyConfiguration']) {
    observations[`local settings.json ${key}`] = describeSetting(localSettings, key);
    observations[`remote Machine/settings.json ${key}`] = describeSetting(machineSettings, key);
  }
  return { observations, problems };
}

function describeSetting(settings: object, key: string): string {
  const value: unknown = (settings as Record<string, unknown>)[key];
  return value === undefined ? 'absent' : JSON.stringify(value);
}

// Resolves with the problems of a window that did not close by itself after its tests.
async function openSshWindow(
  version: string,
  window: { folder: string; userDataDir: string },
  extensionsDir: string
): Promise<string[]> {
  const probe = `vscode-remote://${REMOTE_AUTHORITY}${REMOTE_PROBE}`;
  const closed = runTests({
    version,
    extensionDevelopmentPath: probe,
    extensionTestsPath: `${probe}/remote.js`,
    launchArgs: [
      // A remote extensionDevelopmentPath alone opens a local window.
      '--remote',
      REMOTE_AUTHORITY,
      '--folder-uri',
      `vscode-remote://${REMOTE_AUTHORITY}${window.folder}`,
      '--user-data-dir',
      window.userDataDir,
      '--extensions-dir',
      extensionsDir
    ]
  }).then(
    () => [],
    (error: unknown) => [`the window at ${window.folder} failed: ${String(error)}`]
  );
  const problems = await settledWithin(closed, WINDOW_TIMEOUT_MS);
  if (problems) {
    return problems;
  }
  // VS Code's processes all name the profile's user data directory in their arguments. Where
  // pkill stops nothing, the probe moves on and leaves the window open.
  await promisify(execFile)('pkill', ['-f', window.userDataDir]).catch(() => undefined);
  await settledWithin(closed, KILL_WAIT_MS);
  return [`the window at ${window.folder} did not close within ${WINDOW_TIMEOUT_MS / 1000} s`];
}

// Resolves with undefined when the promise has not settled within `ms`.
async function settledWithin<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForRemoteFile(file: string, windowClosed: Promise<unknown>): Promise<boolean> {
  let closed = false;
  void windowClosed.then(() => (closed = true));
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (!closed && Date.now() < deadline) {
    if (
      await sshHost(['test', '-f', file]).then(
        () => true,
        () => false
      )
    ) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// Runs a command in the SSH host container, as the account that Remote-SSH logs in to.
function sshHost(command: string[], user = 'lab'): Promise<string> {
  return compose(['exec', '-T', '--user', user, 'ssh-host', ...command]);
}

function writeRemoteFile(file: string, content: string): Promise<string> {
  const script = 'mkdir -p "$(dirname "$1")" && printf %s "$2" > "$1"';
  return sshHost(['sh', '-c', script, 'sh', file, content]);
}

// An absent file reads as an empty object.
async function readRemoteJson(file: string): Promise<Record<string, string>> {
  const content = await sshHost(['sh', '-c', 'cat "$1" 2>/dev/null || true', 'sh', file]);
  return content.trim() === '' ? {} : (JSON.parse(content) as Record<string, string>);
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
