import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, bounds, getStyle, isFramelessFileNode, parseCanvas, serializeCanvas, type CanvasData } from '../src/shared/canvas';

const fixture = (): CanvasData => ({
  custom: { revision: 'agent' },
  nodes: [
    { id: 'a', type: 'text', x: -20, y: 10, width: 100, height: 80, text: 'Hello', custom: { keep: true }, canvasStudio: { radius: 12, vendor: 'keep' } },
    { id: 'b', type: 'file', x: 200, y: 20, width: 120, height: 100, file: 'child.canvas' },
  ],
  edges: [{ id: 'e', fromNode: 'a', toNode: 'b', label: 'flow', custom: true }],
});

test('accepts the four standard node types and optional empty arrays', () => {
  assert.deepEqual(parseCanvas('{}'), { nodes: [], edges: [] });
  const data = fixture();
  data.nodes.push({ id: 'link', type: 'link', x: 0, y: 0, width: 100, height: 100, url: 'https://example.com' });
  data.nodes.push({ id: 'group', type: 'group', x: 0, y: 0, width: 400, height: 400, label: 'Screen' });
  assert.equal(parseCanvas(JSON.stringify(data)).nodes.length, 4);
});
test('rejects invalid JSON, unsupported types, duplicate ids, and missing text', () => {
  assert.throws(() => parseCanvas('{'), /Invalid JSON/);
  for (const change of [{ type: 'ellipse' }, { id: 'b' }, { text: null }, { width: -1 }, { x: '1' }, { x: 1.5 }, { color: 'red' }]) {
    const data = fixture(); Object.assign(data.nodes[0], change);
    assert.throws(() => parseCanvas(JSON.stringify(data)));
  }
});
test('rejects dangling edges and invalid endpoint conventions', () => {
  const data = fixture(); data.edges[0].toNode = 'missing';
  assert.throws(() => parseCanvas(JSON.stringify(data)), /missing node/);
  data.edges[0].toNode = 'b'; data.edges[0].toSide = 'center' as never;
  assert.throws(() => parseCanvas(JSON.stringify(data)), /toSide/);
});
test('editing preserves unknown root, node, edge, and extension metadata', () => {
  const data = fixture();
  const edited = applyOperation(data, { type: 'updateNodes', updates: [{ id: 'a', patch: { x: 35, canvasStudio: { fill: '#ffffff' } } }] });
  assert.deepEqual(edited.custom, data.custom);
  assert.deepEqual(edited.nodes[0].custom, { keep: true });
  assert.deepEqual(edited.edges, data.edges);
  assert.deepEqual(edited.nodes[0].canvasStudio, { radius: 12, vendor: 'keep', fill: '#ffffff' });
  assert.equal(data.nodes[0].x, -20);
});
test('node deletion removes incident edges and retains other nodes', () => {
  const result = applyOperation(fixture(), { type: 'deleteNodes', ids: ['a'] });
  assert.equal(result.nodes[0].id, 'b'); assert.equal(result.edges.length, 0);
});
test('operations cannot change ids or create duplicate nodes', () => {
  const edited = applyOperation(fixture(), { type: 'updateNodes', updates: [{ id: 'a', patch: { id: 'changed' } }] });
  assert.equal(edited.nodes[0].id, 'a');
  assert.throws(() => applyOperation(fixture(), { type: 'addNodes', nodes: [fixture().nodes[0]] }), /unique id/);
  assert.throws(() => applyOperation(fixture(), { type: 'updateNodes', updates: [{ id: 'missing', patch: { x: 1 } }] }), /no longer exists/);
});
test('serialization preserves indentation, line endings, and final newline', () => {
  const source = '{\r\n\t"nodes": [],\r\n\t"edges": []\r\n}\r\n';
  const result = serializeCanvas(parseCanvas(source), source);
  assert.equal(result, source);
  assert.equal(serializeCanvas(parseCanvas('{}'), '{}').endsWith('\n'), false);
});
test('bounds include negative coordinates and dimensions', () => {
  assert.deepEqual(bounds(fixture().nodes), { x: -20, y: 10, width: 340, height: 110 });
  assert.deepEqual(bounds([]), { x: 0, y: 0, width: 800, height: 600 });
});
test('style normalizes untrusted extensions and maps JSON Canvas palette colors', () => {
  const node = fixture().nodes[0];
  node.color = '6'; node.canvasStudio = { radius: -100, fontSize: Infinity, fill: 'url(bad)', shape: 'ellipse' };
  const style = getStyle(node);
  assert.equal(style.stroke, '#9a82db'); assert.equal(style.fill, '#ffffff'); assert.equal(style.radius, 0); assert.equal(style.fontSize, 16); assert.equal(style.shape, 'ellipse');
});

test('PNG and Canvas file references use frameless rendering, including uppercase extensions and subpaths', () => {
  const image = { ...fixture().nodes[1], file: 'assets/transparent.PNG', subpath: '#preview' };
  assert.equal(isFramelessFileNode(image), true);
  for (const file of [
    'assets/transparent.png',
    'child.canvas',
    'components/child.CANVAS',
    'image.png.canvas',
  ]) {
    assert.equal(isFramelessFileNode({ ...image, file }), true);
  }
  for (const file of [
    'photo.jpg',
    'icon.svg',
    'child.canvas.json',
    'image.png.canvas.md',
    'image.png/notes',
  ]) {
    assert.equal(isFramelessFileNode({ ...image, file }), false);
  }
  assert.equal(isFramelessFileNode({ ...image, type: 'group', background: image.file }), false);
  assert.equal(
    isFramelessFileNode({ ...image, type: 'link', url: 'https://example.com/image.png' }),
    false,
  );
});
