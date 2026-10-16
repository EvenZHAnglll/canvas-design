import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { screenshotCommand } from '../src/screenshot-command';

test('copied commands use the installed extension and explicit project paths from any directory', () => {
  const command = screenshotCommand(
    '/extensions/canvas-design',
    '/other-project/design.canvas',
    '/other-project',
    'linux',
  );
  assert.equal(
    command,
    "node '/extensions/canvas-design/scripts/capture-canvas.mjs' '/other-project/design.canvas' --workspace '/other-project'",
  );
});

test('POSIX commands preserve spaces, quotes and shell metacharacters as literal paths', async () => {
  if (process.platform === 'win32') return;
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-shell-'));
  const extension = path.join(root, "extension's $value `test`");
  const canvas = "/project's dir/$(printf unsafe).canvas";
  const workspace = "/project's dir";
  try {
    await mkdir(path.join(extension, 'scripts'), { recursive: true });
    await writeFile(
      path.join(extension, 'scripts', 'capture-canvas.mjs'),
      'console.log(JSON.stringify(process.argv.slice(2)))',
    );
    const command = screenshotCommand(extension, canvas, workspace);
    const output = execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8', cwd: os.tmpdir() });
    assert.deepEqual(JSON.parse(output), [canvas, '--workspace', workspace]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows commands use PowerShell literal quoting and native script paths', () => {
  const command = screenshotCommand(
    'C:\\extensions\\Canvas Design',
    "D:\\User's Project\\design.canvas",
    "D:\\User's Project",
    'win32',
  );
  assert.equal(
    command,
    "node 'C:\\extensions\\Canvas Design\\scripts\\capture-canvas.mjs' 'D:\\User''s Project\\design.canvas' --workspace 'D:\\User''s Project'",
  );
});
