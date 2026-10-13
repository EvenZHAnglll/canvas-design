import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditSession } from '../src/shared/edit-session';
import { applyOperation, type CanvasData, type Operation } from '../src/shared/canvas';
const data: CanvasData = { nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'Initial' }], edges: [] };
const change = (x: number): Operation => ({ type: 'updateNodes', updates: [{ id: 'a', patch: { x } }] });
test('edits are optimistic and serialized using the acknowledged document version', () => {
  const session = new EditSession(); session.receive(1, data);
  session.enqueue('first', change(10)); session.enqueue('second', change(20));
  assert.equal(session.preview().nodes[0].x, 20); assert.equal(session.next()?.baseVersion, 1); assert.equal(session.next(), undefined);
  session.receive(2, applyOperation(data, change(10))); session.acknowledge('first', { version: 2 });
  assert.equal(session.next()?.baseVersion, 2);
});
test('acknowledgements arriving before state retain the optimistic result and wait', () => {
  const session = new EditSession(); session.receive(1, data); session.enqueue('first', change(10)); session.next();
  session.acknowledge('first', { version: 2 }); session.enqueue('second', change(20));
  assert.equal(session.preview().nodes[0].x, 20); assert.equal(session.needsState, true); assert.equal(session.next(), undefined);
  session.receive(2, applyOperation(data, change(10))); assert.equal(session.next()?.baseVersion, 2);
});
test('agent changes cancel unsent writes instead of overwriting new fields', () => {
  const session = new EditSession(); session.receive(1, data); session.enqueue('first', change(10)); session.enqueue('second', change(20)); session.next();
  session.receive(3, applyOperation(data, change(300)));
  assert.match(session.acknowledge('first', { version: 2 })!, /cancelled/);
  assert.equal(session.preview().nodes[0].x, 300); assert.equal(session.next(), undefined);
});
test('stale responses are ignored and rejected edits roll back', () => {
  const session = new EditSession(); session.receive(4, data); session.receive(1, applyOperation(data, change(999)));
  session.enqueue('first', change(10)); session.next();
  session.acknowledge('unrelated', { error: 'Ignore' }); assert.equal(session.preview().nodes[0].x, 10);
  assert.equal(session.acknowledge('first', { error: 'File changed' }), 'File changed'); assert.equal(session.preview().nodes[0].x, 0); assert.equal(session.version, 4);
});
