import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHexColor, toHexColor } from '../src/shared/colors';
import {
  applyOperation,
  getStyle,
  parseCanvas,
  serializeCanvas,
  type CanvasNode,
} from '../src/shared/canvas';

const node: CanvasNode = {
  id: 'a',
  type: 'text',
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  text: 'Color',
};

test('reads opaque and translucent hex colors without accepting CSS expressions', () => {
  assert.deepEqual(parseHexColor('#A4B9CC'), { r: 164, g: 185, b: 204, a: 1 });
  assert.deepEqual(parseHexColor('#A4B9CC80'), { r: 164, g: 185, b: 204, a: 128 / 255 });
  assert.equal(parseHexColor('#a4b9cc00')?.a, 0);
  for (const value of [null, 1, '#fff', '#1234567', 'red', 'url(bad)', '#123456; color:red']) {
    assert.equal(parseHexColor(value), undefined);
  }
});

test('RGBA serialization retains explicit opaque alpha and clamps channel limits', () => {
  assert.equal(toHexColor({ r: 164, g: 185, b: 204, a: 0.5 }), '#a4b9cc80');
  assert.equal(toHexColor({ r: 164, g: 185, b: 204, a: 0 }), '#a4b9cc00');
  assert.equal(toHexColor({ r: 164, g: 185, b: 204, a: 1 }), '#a4b9ccff');
  assert.equal(toHexColor({ r: -1, g: 256, b: 10.6, a: 2 }), '#00ff0bff');
});

test('translucent fill and stroke survive edits and source round trips in extension metadata', () => {
  const data = { nodes: [{ ...node, color: '6', canvasStudio: { vendor: 'keep' } }], edges: [] };
  const edited = applyOperation(data, {
    type: 'updateNodes',
    updates: [
      {
        id: 'a',
        patch: {
          canvasStudio: { fill: '#a4b9cc80', stroke: '#52596200' },
        },
      },
    ],
  });
  const restored = parseCanvas(serializeCanvas(edited, '{}')).nodes[0];
  assert.equal(getStyle(restored).fill, '#a4b9cc80');
  assert.equal(getStyle(restored).stroke, '#52596200');
  assert.equal(restored.canvasStudio?.vendor, 'keep');
  assert.equal(restored.color, '6');
  assert.throws(() => parseCanvas(JSON.stringify({ nodes: [{ ...node, color: '#a4b9cc80' }] })));
});

test('groups preserve legacy translucency and honor explicit alpha without multiplying it', () => {
  const group = { ...node, type: 'group' as const };
  assert.equal(getStyle(group).fill, '#e9edf550');
  assert.equal(getStyle({ ...group, canvasStudio: { fill: '#a4b9cc' } }).fill, '#a4b9cc50');
  for (const fill of ['#a4b9cc00', '#a4b9cc80', '#a4b9ccff']) {
    assert.equal(getStyle({ ...group, canvasStudio: { fill } }).fill, fill);
  }
  assert.equal(
    getStyle({ ...node, canvasStudio: { fill: 'url(bad)', stroke: '#invalid' } }).fill,
    '#ffffff',
  );
  assert.equal(getStyle({ ...node, canvasStudio: { stroke: '#invalid' } }).stroke, '#c9d2e2');
});
