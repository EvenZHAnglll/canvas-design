import { build } from 'esbuild';
import { mkdtemp, cp, mkdir, rm, access } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';

const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-studio-integration-'));
await mkdir(path.join(root, 'tests'));
await cp('examples', path.join(root, 'workspace'), { recursive: true });
await build({
  entryPoints: ['tests/vscode.integration.ts'],
  outfile: path.join(root, 'tests', 'index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
});
let extensionPath = process.cwd();
if (process.env.CANVAS_INTEGRATION_VSIX) {
  const archive = path.resolve(process.env.CANVAS_INTEGRATION_VSIX);
  await promisify(execFile)('unzip', ['-q', archive, '-d', path.join(root, 'package')]);
  extensionPath = path.join(root, 'package', 'extension');
  console.log('Testing the packaged VSIX contents in a separate workspace.');
}
let executable = process.env.VSCODE_EXECUTABLE ?? 'code';
if (!process.env.VSCODE_EXECUTABLE && process.platform === 'darwin') {
  for (const name of ['Code', 'Electron']) {
    const candidate = `/Applications/Visual Studio Code.app/Contents/MacOS/${name}`;
    try {
      await access(candidate);
      executable = candidate;
      break;
    } catch {
      /* Use the CLI if the default app is absent. */
    }
  }
}
const child = spawn(
  executable,
  [
    `--user-data-dir=${path.join(root, 'profile')}`,
    `--extensions-dir=${path.join(root, 'extensions')}`,
    `--extensionDevelopmentPath=${extensionPath}`,
    `--extensionTestsPath=${path.join(root, 'tests', 'index.cjs')}`,
    '--disable-extensions',
    '--skip-welcome',
    '--skip-release-notes',
    path.join(root, 'workspace'),
  ],
  { stdio: 'inherit' },
);
let expired = false;
const timer = setTimeout(() => {
  expired = true;
  child.kill('SIGTERM');
}, 90000);
let result;
try {
  result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  clearTimeout(timer);
  await rm(root, { recursive: true, force: true });
}
if (expired) console.error('VS Code integration run exceeded 90 seconds.');
process.exit(expired ? 1 : result);
