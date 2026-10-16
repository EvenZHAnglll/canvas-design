import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { prepareFileNodes } from '../src/file-insertion';
import { referenceCandidates } from '../src/shared/paths';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-files-'));
  await mkdir(path.join(root, 'design'));
  await mkdir(path.join(root, 'assets'));
  return {
    root,
    document: path.join(root, 'design', 'main.canvas'),
    uri: (file: string) => pathToFileURL(path.join(root, file)).href,
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test('inserts Markdown, images, and canvases as relative file references in one ordered batch', async () => {
  const f = await fixture();
  try {
    for (const name of ['read me 中文.md', 'assets/image.png', 'design/child.canvas'])
      await writeFile(path.join(f.root, name), 'fixture');
    const uris = ['read me 中文.md', 'assets/image.png', 'design/child.canvas'].map(f.uri);
    const nodes = await prepareFileNodes(f.document, [f.root], [...uris, uris[0]], -42.6, 100.4);
    assert.deepEqual(
      nodes.map((node) => node.file),
      ['../read me 中文.md', '../assets/image.png', 'child.canvas'],
    );
    assert.deepEqual(
      nodes.map((node) => [node.x, node.y]),
      [
        [-43, 100],
        [-11, 132],
        [21, 164],
      ],
    );
    assert.ok(
      nodes.every((node) => node.type === 'file' && node.width === 420 && node.height === 300),
    );
    assert.equal(new Set(nodes.map((node) => node.id)).size, 3);
    assert.equal(
      referenceCandidates(f.document, nodes[0].file!, [f.root])[0],
      path.join(f.root, 'read me 中文.md'),
    );
  } finally {
    await f.close();
  }
});

test('rejects directories, nonlocal URIs, outside files, missing files, and symlink escapes atomically', async () => {
  const f = await fixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'canvas-files-outside-'));
  try {
    await writeFile(path.join(f.root, 'safe.md'), 'safe');
    await writeFile(path.join(outside, 'secret.md'), 'outside');
    await symlink(path.join(outside, 'secret.md'), path.join(f.root, 'escape.md'));
    for (const uri of [
      f.uri('assets'),
      'https://example.com/a.md',
      pathToFileURL(path.join(outside, 'secret.md')).href,
      f.uri('missing.md'),
      f.uri('escape.md'),
    ]) {
      await assert.rejects(prepareFileNodes(f.document, [f.root], [f.uri('safe.md'), uri], 0, 0));
    }
    for (const uris of [[], null, ['file:///a', 42], Array(101).fill(f.uri('safe.md'))])
      await assert.rejects(prepareFileNodes(f.document, [f.root], uris, 0, 0));
    for (const position of [NaN, Infinity, '0', Number.MAX_SAFE_INTEGER * 2])
      await assert.rejects(prepareFileNodes(f.document, [f.root], [f.uri('safe.md')], position, 0));
  } finally {
    await f.close();
    await rm(outside, { recursive: true, force: true });
  }
});

test('canonical workspace aliases still produce readable references and deduplicate symlinked files', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, 'safe.md'), 'safe');
    const alias = path.join(f.root, 'alias');
    await symlink(path.join(f.root, 'assets'), alias);
    await writeFile(path.join(f.root, 'assets', 'aliased.md'), 'safe');
    const nodes = await prepareFileNodes(
      path.join(alias, 'main.canvas'),
      [],
      [f.uri('assets/aliased.md'), f.uri('alias/aliased.md')],
      0,
      0,
    );
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].file, 'aliased.md');
    assert.equal(
      referenceCandidates(path.join(alias, 'main.canvas'), nodes[0].file!, []).length,
      1,
    );
  } finally {
    await f.close();
  }
});
