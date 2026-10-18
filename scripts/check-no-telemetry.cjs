// The extension collects no telemetry; fail if a telemetry SDK enters the dependency tree.
const fs = require('node:fs');
const path = require('node:path');

const bannedPackages = new Set([
  'applicationinsights',
  'vscode-extension-telemetry',
  '@microsoft/applicationinsights-web',
  '@microsoft/applicationinsights-core-js'
]);

// Lockfile keys look like "node_modules/a/node_modules/b"; the last segment names the package.
function getPackageNameFromLockPath(modulePath) {
  if (!modulePath.includes('node_modules/')) {
    return undefined;
  }

  const parts = modulePath.split('node_modules/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : undefined;
}

function asRecord(value) {
  if (value && typeof value === 'object') {
    return value;
  }

  return {};
}

function findBannedPackages(lockPath) {
  const lockText = fs.readFileSync(lockPath, 'utf8');
  const lock = JSON.parse(lockText);

  const found = new Set();

  const packages = asRecord(lock.packages);
  for (const lockKey of Object.keys(packages)) {
    const packageName = getPackageNameFromLockPath(lockKey);
    if (packageName && bannedPackages.has(packageName)) {
      found.add(packageName);
    }
  }

  const dependencies = asRecord(lock.dependencies);
  for (const packageName of Object.keys(dependencies)) {
    if (bannedPackages.has(packageName)) {
      found.add(packageName);
    }
  }

  return Array.from(found).sort();
}

const lockPath = path.join(process.cwd(), 'package-lock.json');

if (!fs.existsSync(lockPath)) {
  console.error('Missing package-lock.json; cannot verify telemetry dependencies.');
  process.exit(1);
}

const found = findBannedPackages(lockPath);
if (found.length === 0) {
  process.exit(0);
}

console.error('Telemetry dependencies are not allowed in this project.');
console.error(`Found: ${found.join(', ')}`);
process.exit(1);
