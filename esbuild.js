const fs = require('node:fs');
const path = require('node:path');

const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  // Start from an empty folder so files from earlier builds are never packaged.
  fs.rmSync(path.join(__dirname, 'dist'), { recursive: true, force: true });

  const context = await esbuild.context({
    absWorkingDir: __dirname,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    bundle: true,
    format: 'cjs',
    platform: 'node',
    // VS Code 1.91, the engines.vscode minimum, runs extensions on Node 20.9.
    target: 'node20',
    external: ['vscode'],
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    logLevel: 'info'
  });

  if (watch) {
    await context.watch();
    return;
  }

  await context.rebuild();
  await context.dispose();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
