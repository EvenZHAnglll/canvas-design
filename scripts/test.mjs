import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';

const files = (await readdir('tests')).filter((file) => file.endsWith('.test.ts'));
await build({
  entryPoints: files.map((file) => `tests/${file}`),
  outdir: '.test-build',
  bundle: true,
  platform: 'node',
  format: 'esm',
  alias: { vscode: './tests/vscode-mock.ts' },
  outExtension: { '.js': '.mjs' },
});
const result = spawnSync(
  process.execPath,
  ['--test', ...files.map((file) => `.test-build/${file.replace(/\.ts$/, '.mjs')}`)],
  { stdio: 'inherit' },
);
await rm('.test-build', { recursive: true, force: true });
process.exit(result.status ?? 1);
