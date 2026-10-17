import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { applyOperation, type CanvasData } from '../src/shared/canvas';
import { syncFlowNodes, type StudioNode } from '../src/webview/flow-nodes';

// Load the installed renderer directly; bundling its server-side CommonJS into
// the test runner's ESM output would leave unsupported dynamic require calls.
const require = createRequire(import.meta.url);
const { createElement } = require('react') as typeof import('react');
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');
const { ReactFlow } = require('@xyflow/react') as typeof import('@xyflow/react');

const source: CanvasData = {
  nodes: [
    { id: 'shape', type: 'text', x: -40, y: 20, width: 220, height: 140, text: 'Hello' },
    { id: 'image', type: 'file', x: 300, y: 20, width: 200, height: 160, file: 'image.png' },
    { id: 'nested', type: 'file', x: 600, y: 20, width: 240, height: 180, file: 'child.canvas' },
  ],
  edges: [],
};
const nodeTypes = { canvas: () => createElement('span', null, 'Canvas node') };

function assertVisible(nodes: StudioNode[]) {
  // Exercise React Flow's actual node wrapper: CSS dimensions without known
  // width/height or measurements render as visibility:hidden until remeasured.
  const markup = renderToStaticMarkup(
    createElement(ReactFlow<StudioNode>, {
      nodes,
      edges: [],
      nodeTypes,
      width: 1000,
      height: 800,
    }),
  );
  for (const node of nodes) {
    const wrapper = markup.match(new RegExp(`<div[^>]*data-id="${node.id}"[^>]*>`))?.[0];
    assert.ok(wrapper, `${node.id} has a rendered wrapper`);
    assert.match(wrapper, /visibility:visible/, `${node.id} stays visible`);
  }
}

test('nodes have known dimensions and stay visible before the first browser measurement', () => {
  const nodes = syncFlowNodes([], source.nodes, {}, new Set());
  assertVisible(nodes);
});

test('repeated numeric previews keep every node visible and retain existing measurements', () => {
  const selected = new Set(['shape']);
  let current: StudioNode[] = syncFlowNodes([], source.nodes, {}, selected).map((node) => ({
    ...node,
    measured: { width: node.width, height: node.height },
  }));
  const measurements = current.map((node) => node.measured);
  for (const value of [230, 260, 200, 240]) {
    const preview = applyOperation(source, {
      type: 'updateNodes',
      updates: [{ id: 'shape', patch: { width: value, canvasDesign: { fontSize: value / 10 } } }],
    });
    current = syncFlowNodes(current, preview.nodes, {}, selected);
    assertVisible(current);
    assert.equal(current[0].width, value);
    assert.equal(current[0].style?.width, value);
    assert.equal(current[0].data.canvas.canvasDesign?.fontSize, value / 10);
    current.forEach((node, index) => assert.equal(node.measured, measurements[index]));
  }
  const cancelled = syncFlowNodes(current, source.nodes, {}, selected);
  assertVisible(cancelled);
  assert.equal(cancelled[0].width, source.nodes[0].width);
});

test('synchronization preserves active drag positions and follows source geometry after the drag', () => {
  const current = syncFlowNodes([], source.nodes, {}, new Set());
  current[0].position = { x: 100, y: 200 };
  const asset = { uri: 'image-resource' };
  const reordered = [source.nodes[1], { ...source.nodes[0], x: 30, width: 300 }];
  const duringDrag = syncFlowNodes(current, reordered, { image: asset }, new Set(['image']), true);
  assert.deepEqual(duringDrag[1].position, { x: 100, y: 200 });
  assert.equal(duringDrag[1].width, 300);
  assert.equal(duringDrag[0].data.asset, asset);
  assert.deepEqual(
    duringDrag.map((node) => [node.id, node.selected, node.zIndex]),
    [
      ['image', true, 0],
      ['shape', false, 1],
    ],
  );
  const afterDrag = syncFlowNodes(duringDrag, reordered, {}, new Set());
  assert.deepEqual(afterDrag[1].position, { x: 30, y: 20 });
});
