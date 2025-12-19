/* eslint-disable no-console */

const path = require('node:path');

const esbuild = require('esbuild');

/**
 * Bundles the VS Code extension entrypoint for production packaging.
 *
 * @param {string[]} args CLI args (e.g., `--watch`, `--production`).
 * @returns {Promise<void>}
 * @throws {Error} If bundling fails.
 * @example
 * ```sh
 * node esbuild.js --production
 * ```
 */
async function bundleExtension(args) {
  const isProduction = args.includes('--production');
  const isWatch = args.includes('--watch');

  const entryPoint = path.join(__dirname, 'src', 'extension.ts');
  const outfile = path.join(__dirname, 'out', 'src', 'extension.js');

  const buildOptions = {
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    sourcemap: true,
    minify: isProduction,
    external: ['vscode'],
    logLevel: 'info'
  };

  if (!isWatch) {
    await esbuild.build(buildOptions);
    return;
  }

  const context = await esbuild.context(buildOptions);
  await context.watch();
  console.log('esbuild: watching for changes...');
}

bundleExtension(process.argv.slice(2)).catch((error) => {
  console.error('esbuild: failed to bundle extension.', error);
  process.exitCode = 1;
});

