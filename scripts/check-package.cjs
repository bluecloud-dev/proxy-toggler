// Checks the packaged VSIX before it is shared: its size, that it holds exactly the expected
// files, and that its manifest matches package.json. Prints the SHA-256 of the checked bytes.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const yauzl = require('yauzl');

const MAX_BYTES = 256 * 1024;

// vsce lowercases readme.md and changelog.md and renames LICENSE to LICENSE.txt. A new file in
// the package must be added here on purpose; anything else, such as src/ or tests/, fails.
const EXPECTED_FILES = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/LICENSE.txt',
  'extension/assets/hero.png',
  'extension/assets/hero.svg',
  'extension/assets/icon.png',
  'extension/assets/icon.svg',
  'extension/changelog.md',
  'extension/dist/extension.js',
  'extension/package.json',
  'extension/package.nls.json',
  'extension/readme.md'
];

const MANIFEST_FIELDS = ['name', 'publisher', 'version', 'main'];

function readEntries(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (openError, zip) => {
      if (openError) {
        reject(openError);
        return;
      }

      const entries = new Map();
      zip.on('error', reject);
      zip.on('end', () => resolve(entries));
      zip.on('entry', (entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            reject(streamError);
            return;
          }

          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

function findProblems(bytes, entries, manifest) {
  const problems = [];

  if (bytes.length > MAX_BYTES) {
    problems.push(`The package is ${bytes.length} bytes; the budget is ${MAX_BYTES}.`);
  }

  const files = [...entries.keys()].filter((name) => !name.endsWith('/'));
  for (const name of files) {
    if (!EXPECTED_FILES.includes(name)) {
      problems.push(`Unexpected file: ${name}`);
    }
  }
  for (const name of EXPECTED_FILES) {
    if (!entries.has(name)) {
      problems.push(`Missing file: ${name}`);
    }
  }

  const packagedManifest = entries.get('extension/package.json');
  const packaged = packagedManifest ? JSON.parse(packagedManifest.toString('utf8')) : {};
  for (const field of MANIFEST_FIELDS) {
    if (packaged[field] !== manifest[field]) {
      problems.push(
        `Packaged ${field} is ${packaged[field]}; package.json says ${manifest[field]}.`
      );
    }
  }

  return problems;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const vsixPath = process.argv[2] ?? `${manifest.name}-${manifest.version}.vsix`;

  // Check and hash the same bytes, even if another build replaces the file meanwhile.
  const bytes = fs.readFileSync(vsixPath);
  const problems = findProblems(bytes, await readEntries(bytes), manifest);

  if (problems.length > 0) {
    console.error(`${vsixPath} failed the package check:`);
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    process.exit(1);
  }

  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  console.log(`${path.basename(vsixPath)}: ${bytes.length} bytes, sha256 ${sha256}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
