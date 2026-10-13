import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canExpandCanvas, isWithin, referenceCandidates } from '../src/shared/paths';

test('resolves document-relative before workspace-relative references', () => {
  assert.deepEqual(referenceCandidates('/project/design/main.canvas', 'assets/logo.png', ['/project']), ['/project/design/assets/logo.png', '/project/assets/logo.png']);
});
test('permits parent traversal only when it remains in an allowed workspace', () => {
  assert.deepEqual(referenceCandidates('/project/design/main.canvas', '../assets/logo.png', ['/project']), ['/project/assets/logo.png']);
  assert.deepEqual(referenceCandidates('/project/design/main.canvas', '../../../secret.png', ['/project']), []);
  assert.equal(isWithin('/project', '/project-neighbor/secret'), false);
});
test('rejects URLs, null bytes, and absolute paths outside roots', () => {
  for (const reference of ['https://example.com/image.png', 'file:///private/data', '/outside/image.png', 'a\0.png']) assert.deepEqual(referenceCandidates('/project/main.canvas', reference, ['/project']), []);
});
test('detects circular references and caps expansion depth', () => {
  assert.match(canExpandCanvas('main', ['main', 'child'], 1)!, /Circular/);
  assert.match(canExpandCanvas('fifth', ['main'], 4)!, /depth/);
  assert.equal(canExpandCanvas('child', ['main'], 0), undefined);
});
