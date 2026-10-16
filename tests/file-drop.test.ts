import test from 'node:test';
import assert from 'node:assert/strict';
import { droppedFileUris, hasFileDrop } from '../src/shared/file-drop';

function transfer(entries: Record<string, string>) {
  return {
    types: Object.keys(entries),
    getData: (format: string) =>
      Object.entries(entries).find(([key]) => key.toLowerCase() === format.toLowerCase())?.[1] ??
      '',
  };
}
test('reads Explorer ResourceURLs with encoded filenames and deduplicates resources', () => {
  const uris = [
    'file:///workspace/read%20me.md',
    'file:///workspace/image.png',
    'file:///workspace/child.canvas',
  ];
  const value = transfer({ resourceurls: JSON.stringify([...uris, uris[0]]) });
  assert.equal(hasFileDrop(value), true);
  assert.deepEqual(droppedFileUris(value), uris);
});
test('accepts URI lists with comments and falls back from malformed Explorer data', () => {
  for (const format of ['text/uri-list', 'application/vnd.code.uri-list']) {
    const value = transfer({
      ResourceURLs: '{broken',
      [format]:
        '# files\r\nfile:///project/a.md\r\n\nhttps://example.com/b.png\nfile:///project/b.canvas',
    });
    assert.deepEqual(droppedFileUris(value), ['file:///project/a.md', 'file:///project/b.canvas']);
  }
});
test('ignores internal Outliner drags, ordinary text, malformed data and non-file resources', () => {
  for (const value of [
    transfer({ 'application/x-canvas-node': 'node' }),
    transfer({ 'text/plain': '/project/a.md' }),
  ]) {
    assert.equal(hasFileDrop(value), false);
    assert.deepEqual(droppedFileUris(value), []);
  }
  for (const value of ['null', '{}', '42', '[null,42,"https://example.com/a"]'])
    assert.deepEqual(droppedFileUris(transfer({ ResourceURLs: value })), []);
});
