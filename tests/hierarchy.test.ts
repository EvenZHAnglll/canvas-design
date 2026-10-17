import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, type CanvasData, type CanvasNode } from '../src/shared/canvas';
import { getHierarchy, descendantIds, moveNode } from '../src/shared/hierarchy';

function node(id: string, type: 'text' | 'group', x: number, width: number): CanvasNode {
  return { id, type, x, y: x, width, height: width, ...(type === 'text' ? { text: id } : { label: id }) };
}
function fixture(): CanvasData { return { nodes: [node('screen', 'group', 0, 500), node('card', 'group', 10, 200), node('title', 'text', 20, 80), node('footer', 'text', 300, 50), node('outside', 'text', 800, 50)], edges: [], vendor: { keep: true } }; }
test('infers the smallest containing group and avoids cycles for equal-size groups', () => {
  const data = fixture(); const tree = getHierarchy(data.nodes);
  assert.equal(tree.parents.get('title'), 'card'); assert.equal(tree.parents.get('card'), 'screen');
  assert.equal(tree.parents.get('outside'), null);
  data.nodes.push(node('same', 'group', 0, 500));
  assert.equal(getHierarchy(data.nodes).parents.get('same'), null);
});
test('explicit root membership overrides containment and cyclic metadata is recoverable', () => {
  const data = fixture(); data.nodes[2].canvasDesign = { parentId: null };
  data.nodes[0].canvasDesign = { parentId: 'card' }; data.nodes[1].canvasDesign = { parentId: 'screen' };
  const tree = getHierarchy(data.nodes);
  assert.equal(tree.parents.get('title'), null); assert.equal(tree.parents.get('screen'), null); assert.equal(tree.parents.get('card'), null);
});
test('moving into and out of a group preserves absolute coordinates and metadata', () => {
  const data = fixture(); data.nodes[4].custom = { keep: 'node' };
  const result = moveNode(data, { type: 'moveNode', id: 'outside', targetId: 'card', placement: 'inside' });
  assert.equal(getHierarchy(result.nodes).parents.get('outside'), 'card');
  assert.equal(result.nodes.find(item => item.id === 'outside')!.x, 800);
  assert.deepEqual(result.vendor, data.vendor); assert.deepEqual(result.nodes.find(item => item.id === 'outside')!.custom, { keep: 'node' });
  const root = moveNode(result, { type: 'moveNode', id: 'title', targetId: null, placement: 'inside' });
  assert.equal(getHierarchy(root.nodes).parents.get('title'), null);
  assert.equal(data.nodes[4].canvasDesign, undefined);
});
test('outliner before/after reorder the whole subtree with standard ascending z-order', () => {
  const result = moveNode(fixture(), { type: 'moveNode', id: 'card', targetId: 'footer', placement: 'before' });
  assert.deepEqual(result.nodes.map(item => item.id), ['screen', 'footer', 'card', 'title', 'outside']);
  assert.deepEqual([...descendantIds(getHierarchy(result.nodes), 'card')], ['card', 'title']);
  const after = moveNode(result, { type: 'moveNode', id: 'card', targetId: 'footer', placement: 'after' });
  assert.deepEqual(after.nodes.map(item => item.id), fixture().nodes.map(item => item.id));
});
test('invalid drops are rejected without changing the input', () => {
  const data = fixture(); const before = JSON.stringify(data);
  for (const target of ['card', 'title', 'screen']) assert.throws(() => moveNode(data, { type: 'moveNode', id: 'screen', targetId: target, placement: 'inside' }));
  assert.throws(() => moveNode(data, { type: 'moveNode', id: 'outside', targetId: 'title', placement: 'inside' }), /Only groups/);
  assert.equal(JSON.stringify(data), before);
});
test('deleting a group removes descendants and incident connections atomically', () => {
  const data = fixture(); data.edges = [{ id: 'flow', fromNode: 'title', toNode: 'outside' }];
  const result = applyOperation(data, { type: 'deleteNodes', ids: ['card'] });
  assert.deepEqual(result.nodes.map(item => item.id), ['screen', 'footer', 'outside']); assert.equal(result.edges.length, 0);
});

test('reordering overlapping PNG layers changes stacking order without changing geometry or styles', () => {
  const background: CanvasNode = {
    id: 'background',
    type: 'text',
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    text: 'Underneath',
  };
  const image: CanvasNode = {
    id: 'overlay',
    type: 'file',
    file: 'transparent.png',
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    canvasDesign: { fill: '#ffffff', stroke: '#123456', radius: 24, vendor: 'keep' },
  };
  const data: CanvasData = { nodes: [background, image], edges: [] };
  const behind = moveNode(data, {
    type: 'moveNode',
    id: image.id,
    targetId: background.id,
    placement: 'after',
  });
  assert.deepEqual(
    behind.nodes.map((item) => item.id),
    ['overlay', 'background'],
  );
  const inFront = moveNode(behind, {
    type: 'moveNode',
    id: image.id,
    targetId: background.id,
    placement: 'before',
  });
  assert.deepEqual(
    inFront.nodes.map((item) => item.id),
    ['background', 'overlay'],
  );
  const reordered = inFront.nodes.find((item) => item.id === image.id)!;
  assert.deepEqual(reordered, {
    ...image,
    canvasDesign: { ...image.canvasDesign, parentId: null },
  });
  assert.deepEqual(data.nodes, [background, image]);
});
