import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const validator = path.resolve('scripts/validate-package.mjs');

async function validate(icon: Buffer) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-package-test-'));
  try {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ icon: 'icon.png' }));
    await writeFile(path.join(root, 'icon.png'), icon);
    return await run(process.execPath, [validator], { cwd: root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('package validation accepts the shipped Marketplace PNG icon', async () => {
  const result = await validate(await readFile('media/icon.png'));
  assert.match(result.stdout, /Validated icon: 512 x 512/);
});

test('package validation rejects an oversized PNG before upload', async () => {
  const icon = await readFile('media/icon.png');
  await assert.rejects(validate(Buffer.concat([icon, Buffer.alloc(1_024_001)])), {
    stderr: /no larger than 1024000 bytes/,
  });
});

test('package validation rejects invalid PNG headers and unsuitable dimensions', async () => {
  await assert.rejects(validate(Buffer.alloc(33)), { stderr: /valid PNG header/ });
  const icon = await readFile('media/icon.png');
  icon.writeUInt32BE(64, 16);
  await assert.rejects(validate(icon), { stderr: /square and at least 128 x 128/ });
  icon.writeUInt32BE(256, 16);
  await assert.rejects(validate(icon), { stderr: /square and at least 128 x 128/ });
});
