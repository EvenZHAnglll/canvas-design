import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as mock from './vscode-mock';
import { ScreenshotService, decodeScreenshot } from '../src/screenshot';
import { screenshotFrame, screenshotMaxPixels } from '../src/shared/screenshot';
import type { CanvasData } from '../src/shared/canvas';

const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';

test('export bounds include the complete canvas and negative coordinates with padding', () => {
  const data: CanvasData = {
    nodes: [
      { id: 'a', type: 'text', x: -100, y: -50, width: 200, height: 100 },
      { id: 'b', type: 'file', file: 'image.png', x: 400, y: 300, width: 100, height: 100 },
    ],
    edges: [],
  };
  assert.deepEqual(screenshotFrame(data), { width: 1328, height: 1028, scale: 2, x: 264, y: 164 });
});

test('very large and empty canvases have bounded, nonzero PNG dimensions', () => {
  for (const nodes of [
    [],
    [{ id: 'large', type: 'text' as const, x: 0, y: 0, width: 1_000_000, height: 1_000_000 }],
  ]) {
    const frame = screenshotFrame({ nodes, edges: [] });
    assert.ok(frame.width > 0 && frame.height > 0);
    assert.ok(frame.width <= 4096 && frame.height <= 4096);
    assert.ok(frame.width * frame.height <= screenshotMaxPixels);
  }
});

test('PNG responses validate type, header and output dimensions', () => {
  const decoded = decodeScreenshot(image);
  assert.equal(decoded.width, 1);
  assert.equal(decoded.height, 1);
  for (const value of [null, 'data:text/html;base64,AAAA', 'data:image/png;base64,AAAA']) {
    assert.throws(() => decodeScreenshot(value), /Invalid PNG/);
  }
  const oversized = Buffer.from(decoded.png);
  oversized.writeUInt32BE(9000, 16);
  assert.throws(
    () => decodeScreenshot(`data:image/png;base64,${oversized.toString('base64')}`),
    /limit/,
  );
});

async function fixture() {
  mock.reset();
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-screenshot-'));
  const uri = mock.Uri.file(path.join(root, 'test.canvas'));
  await writeFile(uri.fsPath, '{"nodes":[],"edges":[]}');
  const document = new mock.Document(uri, '{"nodes":[],"edges":[]}');
  const panel = new mock.Panel();
  const service = new ScreenshotService();
  service.register(document as never, panel as never, async () => {});
  service.ready(panel as never);
  const request = async () => {
    for (let i = 0; i < 100; i++) {
      const message = panel.messages.find((item) => item.type === 'captureScreenshot');
      if (message) return message;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error('No screenshot request sent');
  };
  return {
    root,
    uri,
    document,
    panel,
    service,
    request,
    async close() {
      service.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('programmatic export writes PNG and returns its file path, version and dimensions', async () => {
  const f = await fixture();
  try {
    const output = mock.Uri.file(path.join(f.root, 'export.png'));
    const pending = f.service.save(f.uri as never, output as never);
    const request = await f.request();
    f.service.receive(f.panel as never, { ...request, dataUrl: image });
    const result = await pending;
    assert.equal(result?.path, output.fsPath);
    assert.equal(result?.version, 1);
    assert.equal(result?.width, 1);
    assert.deepEqual(await readFile(output.fsPath), Buffer.from(decodeScreenshot(image).png));
  } finally {
    await f.close();
  }
});

test('a screenshot response from a different editor cannot fulfill a request', async () => {
  const f = await fixture();
  try {
    const pending = f.service.capture(f.uri as never);
    const request = await f.request();
    f.service.receive(new mock.Panel() as never, { ...request, dataUrl: image });
    f.service.receive(f.panel as never, { ...request, dataUrl: image });
    assert.equal((await pending).version, 1);
  } finally {
    await f.close();
  }
});

test('edits during export and renderer failures reject the screenshot', async () => {
  for (const reason of ['changed', 'error', 'closed']) {
    const f = await fixture();
    try {
      const pending = f.service.capture(f.uri as never);
      const rejection = assert.rejects(
        pending,
        reason === 'changed' ? /changed/ : reason === 'closed' ? /closed/ : /load image/,
      );
      const request = await f.request();
      if (reason === 'changed') f.document.setText('{"nodes":[],"edges":[],"changed":true}');
      if (reason === 'closed') f.service.remove(f.panel as never);
      else
        f.service.receive(f.panel as never, {
          ...request,
          dataUrl: image,
          ...(reason === 'error' ? { error: 'Unable to load image' } : {}),
        });
      await rejection;
    } finally {
      await f.close();
    }
  }
});

test('cancelling the save dialog does not ask the renderer for an image', async () => {
  const f = await fixture();
  try {
    assert.equal(await f.service.save(f.uri as never), undefined);
    assert.deepEqual(f.panel.messages, []);
    await assert.rejects(
      f.service.save(f.uri as never, mock.Uri.file(path.join(f.root, 'bad.canvas')) as never),
      /png destination/,
    );
  } finally {
    await f.close();
  }
});
