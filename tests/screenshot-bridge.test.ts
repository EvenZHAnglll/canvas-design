import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as mock from './vscode-mock';
import { registerScreenshotBridge } from '../src/screenshot-bridge';

async function fixture() {
  mock.reset();
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-bridge-'));
  const directory = path.join(root, '.canvas-design', 'screenshots');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(root, 'design.canvas'), '{"nodes":[],"edges":[]}');
  mock.workspace.workspaceFolders = [{ uri: mock.Uri.file(root) }];
  const captures: string[] = [];
  const bridge = registerScreenshotBridge(async (uri) => {
    captures.push(uri.fsPath);
    return { png: new Uint8Array([1, 2, 3]), width: 100, height: 80, version: 3 };
  });
  return {
    root,
    directory,
    captures,
    async request(body: unknown, id = randomUUID()) {
      const file = path.join(directory, `${id}.request.json`);
      await writeFile(file, JSON.stringify(body));
      mock.watchers[0].create(mock.Uri.file(file));
      for (let attempt = 0; attempt < 500; attempt++) {
        try {
          return {
            id,
            result: JSON.parse(await readFile(path.join(directory, `${id}.result.json`), 'utf8')),
          };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
            throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      throw new Error('Bridge did not respond');
    },
    async close() {
      bridge.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('terminal requests produce uniquely named PNGs with metadata and ignore duplicate events', async () => {
  const f = await fixture();
  try {
    const { id, result } = await f.request({ canvas: 'design.canvas' });
    assert.equal(result.width, 100);
    assert.equal(result.version, 3);
    assert.deepEqual(await readFile(result.path), Buffer.from([1, 2, 3]));
    mock.watchers[0].create(mock.Uri.file(path.join(f.directory, `${id}.request.json`)));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(f.captures.length, 1);
  } finally {
    await f.close();
  }
});

test('automation rejects traversal, absolute paths, and symlinked canvases outside the workspace', async () => {
  const f = await fixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'canvas-bridge-outside-'));
  try {
    const external = path.join(outside, 'private.canvas');
    await writeFile(external, '{"nodes":[],"edges":[]}');
    await symlink(external, path.join(f.root, 'linked.canvas'));
    for (const canvas of [external, path.relative(f.root, external), 'linked.canvas']) {
      const { result } = await f.request({ canvas });
      assert.match(result.error, /workspace|relative/);
    }
    assert.equal(f.captures.length, 0);
  } finally {
    await f.close();
    await rm(outside, { recursive: true, force: true });
  }
});

test('automation never follows an existing PNG output symlink', async () => {
  const f = await fixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'canvas-bridge-protected-'));
  try {
    const id = randomUUID();
    const protectedFile = path.join(outside, 'protected.txt');
    await writeFile(protectedFile, 'keep');
    await symlink(protectedFile, path.join(f.directory, `${id}.png`));
    const { result } = await f.request({ canvas: 'design.canvas' }, id);
    assert.ok(result.error);
    assert.equal(await readFile(protectedFile, 'utf8'), 'keep');
  } finally {
    await f.close();
    await rm(outside, { recursive: true, force: true });
  }
});
