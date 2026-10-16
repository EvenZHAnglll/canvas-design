import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as mock from './vscode-mock';
import { activate } from '../src/extension';
import { parseCanvas, type CanvasData } from '../src/shared/canvas';

const empty: CanvasData = { nodes: [], edges: [] };
async function setup(data: CanvasData | string = empty) {
  mock.reset();
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-studio-test-'));
  const uri = mock.Uri.file(path.join(root, 'main.canvas'));
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  await writeFile(uri.fsPath, text);
  mock.workspace.workspaceFolders = [{ uri: mock.Uri.file(root) }];
  const document = new mock.Document(uri, text);
  mock.workspace.textDocuments.push(document);
  activate({ extensionUri: mock.Uri.file(process.cwd()), subscriptions: [] } as never);
  const panel = new mock.Panel();
  await mock.registeredProvider.resolveCustomTextEditor(document, panel);
  await panel.send({ type: 'ready' });
  return { root, uri, document, panel, async close() { panel.dispose(); await rm(root, { recursive: true, force: true }); } };
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for extension message');
    await new Promise(resolve => setImmediate(resolve));
  }
}
const lastState = (panel: mock.Panel) => panel.messages.filter(item => item.type === 'state').at(-1);

test('custom editor initialization returns before the webview can receive messages', async () => {
  const ctx = await setup();
  const unmounted = new mock.Panel();
  unmounted.webview.postMessage = async () => new Promise<boolean>(() => {});
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Resolver waited for an unmounted webview')), 500); });
    await Promise.race([mock.registeredProvider.resolveCustomTextEditor(ctx.document, unmounted), deadline]);
  } finally { clearTimeout(timeout); unmounted.dispose(); await ctx.close(); }
});

test('canvas edits update the VS Code document and reject stale versions', async () => {
  const ctx = await setup();
  try {
    await ctx.panel.send({ type: 'edit', requestId: 'add', baseVersion: 1, operation: { type: 'addNodes', nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'Hello' }] } });
    await until(() => ctx.panel.messages.some(item => item.requestId === 'add'));
    assert.equal(parseCanvas(ctx.document.getText()).nodes.length, 1);
    ctx.document.setText(JSON.stringify({ ...parseCanvas(ctx.document.getText()), agent: 'new revision' }));
    await ctx.panel.send({ type: 'edit', requestId: 'stale', baseVersion: 1, operation: { type: 'deleteNodes', ids: ['a'] } });
    await until(() => ctx.panel.messages.some(item => item.requestId === 'stale'));
    assert.match(ctx.panel.messages.find(item => item.requestId === 'stale').error, /file changed/);
    assert.equal(parseCanvas(ctx.document.getText()).agent, 'new revision');
    assert.equal(parseCanvas(ctx.document.getText()).nodes.length, 1);
  } finally { await ctx.close(); }
});
test('invalid source displays an error and is never replaced by edits', async () => {
  const ctx = await setup('{ broken');
  try {
    assert.match(lastState(ctx.panel).error, /Invalid JSON/);
    await ctx.panel.send({ type: 'edit', requestId: 'bad', baseVersion: 1, operation: { type: 'deleteNodes', ids: [] } });
    await until(() => ctx.panel.messages.some(item => item.requestId === 'bad'));
    assert.equal(ctx.document.getText(), '{ broken');
  } finally { await ctx.close(); }
});
test('nested references expand, circular references stop, and unsaved child edits refresh', async () => {
  const parent: CanvasData = { nodes: [{ id: 'nested', type: 'file', file: 'child.canvas', x: 0, y: 0, width: 300, height: 200 }], edges: [] };
  const ctx = await setup(parent);
  try {
    const child = { nodes: [{ id: 'loop', type: 'file', file: 'main.canvas', x: 0, y: 0, width: 100, height: 100 }], edges: [] };
    const uri = mock.Uri.file(path.join(ctx.root, 'child.canvas'));
    await writeFile(uri.fsPath, JSON.stringify(child));
    await ctx.panel.send({ type: 'ready' });
    assert.match(lastState(ctx.panel).assets.nested.assets.loop.error, /Circular/);
    const childDocument = new mock.Document(uri, JSON.stringify(child));
    mock.workspace.textDocuments.push(childDocument);
    childDocument.setText(JSON.stringify({ nodes: [{ id: 'text', type: 'text', text: 'Agent update', x: 0, y: 0, width: 100, height: 100 }], edges: [] }));
    await until(() => lastState(ctx.panel)?.assets?.nested?.canvas?.nodes?.[0]?.text === 'Agent update');
  } finally { await ctx.close(); }
});
test('image resources are resolved safely, including symlinks', async () => {
  const ctx = await setup({ nodes: [{ id: 'image', type: 'file', file: 'picture.svg', x: 0, y: 0, width: 200, height: 100 }], edges: [] });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'canvas-outside-'));
  try {
    await writeFile(path.join(ctx.root, 'picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await ctx.panel.send({ type: 'ready' });
    assert.match(lastState(ctx.panel).assets.image.uri, /resource\.test/);
    await writeFile(path.join(outside, 'secret.svg'), '<svg/>');
    await rm(path.join(ctx.root, 'picture.svg'));
    await symlink(path.join(outside, 'secret.svg'), path.join(ctx.root, 'picture.svg'));
    await ctx.panel.send({ type: 'ready' });
    assert.match(lastState(ctx.panel).assets.image.error, /outside the workspace/);
  } finally { await ctx.close(); await rm(outside, { recursive: true, force: true }); }
});
test('source, save, undo, and redo requests delegate to VS Code', async () => {
  const ctx = await setup();
  try {
    for (const type of ['source', 'save', 'undo', 'redo']) await ctx.panel.send({ type });
    assert.deepEqual(mock.executed.map(item => item.id), ['vscode.openWith', 'undo', 'redo']);
    assert.equal(mock.executed[0].args[1], 'default');
  } finally { await ctx.close(); }
});

test('copy AI screenshot command resolves the installed script and current project automatically', async () => {
  const ctx = await setup();
  try {
    const copy = mock.commandHandlers.get('canvasStudio.copyScreenshotCommand')! as () => Promise<string>;
    const command = await copy();
    assert.equal(await mock.env.clipboard.readText(), command);
    assert.ok(command.includes(path.join(process.cwd(), 'scripts', 'capture-canvas.mjs')));
    assert.ok(command.includes(ctx.uri.fsPath));
    assert.ok(command.includes(ctx.root));
    mock.workspace.workspaceFolders = [];
    await assert.rejects(copy(), /project folder/);
  } finally { await ctx.close(); }
});

test('file insertion prepares a validated batch and commits it through the versioned editor protocol', async () => {
  const ctx = await setup();
  try {
    await writeFile(path.join(ctx.root, 'notes.md'), '# Notes');
    await writeFile(path.join(ctx.root, 'child.canvas'), '{"nodes":[],"edges":[]}');
    await ctx.panel.send({ type: 'prepareFileNodes', requestId: 'files', baseVersion: 1, uris: ['notes.md', 'child.canvas'].map(file => mock.Uri.file(path.join(ctx.root, file)).toString()), x: -12, y: 34 });
    const prepared = ctx.panel.messages.find(message => message.type === 'fileNodes' && message.requestId === 'files');
    assert.equal(prepared.baseVersion, 1);
    assert.deepEqual(prepared.nodes.map((node: { file: string }) => node.file), ['notes.md', 'child.canvas']);
    assert.equal(parseCanvas(ctx.document.getText()).nodes.length, 0);
    await ctx.panel.send({ type: 'edit', requestId: 'commit-files', baseVersion: 1, operation: { type: 'addNodes', nodes: prepared.nodes } });
    await until(() => ctx.panel.messages.some(item => item.requestId === 'commit-files'));
    assert.equal(parseCanvas(ctx.document.getText()).nodes.length, 2);
    await ctx.panel.send({ type: 'prepareFileNodes', requestId: 'stale-files', baseVersion: 1, uris: [mock.Uri.file(path.join(ctx.root, 'notes.md')).toString()], x: 0, y: 0 });
    assert.match(ctx.panel.messages.find(item => item.requestId === 'stale-files').error, /changed/);
    await ctx.panel.send({ type: 'prepareFileNodes', requestId: 'folder', baseVersion: ctx.document.version, uris: [mock.Uri.file(ctx.root).toString()], x: 0, y: 0 });
    assert.match(ctx.panel.messages.find(item => item.requestId === 'folder').error, /Folders/);
    ctx.panel.active = false;
    await ctx.panel.send({ type: 'prepareFileNodes', requestId: 'hidden', baseVersion: ctx.document.version, uris: [mock.Uri.file(path.join(ctx.root, 'notes.md')).toString()], x: 0, y: 0 });
    assert.match(ctx.panel.messages.find(item => item.requestId === 'hidden').error, /active Canvas changed/);
    assert.equal(parseCanvas(ctx.document.getText()).nodes.length, 2);
  } finally { await ctx.close(); }
});

test('Explorer command targets only a ready active Canvas preview and supports multi-selection', async () => {
  const ctx = await setup();
  try {
    const add = mock.commandHandlers.get('canvasStudio.addFilesToCanvas')!;
    const files = ['notes.md', 'image.png'].map(file => mock.Uri.file(path.join(ctx.root, file)));
    await add(files[0], files);
    assert.deepEqual(ctx.panel.messages.at(-1), { type: 'insertFiles', uris: files.map(uri => uri.toString()) });
    ctx.panel.active = false;
    await assert.rejects(async () => add(files[0]), /visual preview/);
    const otherUri = mock.Uri.file(path.join(ctx.root, 'other.canvas'));
    const otherDocument = new mock.Document(otherUri, '{"nodes":[],"edges":[]}');
    const otherPanel = new mock.Panel();
    mock.workspace.textDocuments.push(otherDocument);
    await mock.registeredProvider.resolveCustomTextEditor(otherDocument, otherPanel);
    await assert.rejects(async () => add(files[0]), /visual preview/);
    await otherPanel.send({ type: 'ready' });
    await add(files[1], files);
    assert.equal(otherPanel.messages.at(-1).type, 'insertFiles');
    assert.equal(ctx.panel.messages.filter(message => message.type === 'insertFiles').length, 1);
    otherPanel.dispose();
    await assert.rejects(async () => add(files[0]), /visual preview/);
  } finally { await ctx.close(); }
});

test('cancelling the file chooser releases the pending insertion without modifying the Canvas', async () => {
  const ctx = await setup();
  try {
    await ctx.panel.send({ type: 'insertFile', requestId: 'cancel', baseVersion: 1, kind: 'file', x: 0, y: 0 });
    assert.deepEqual(ctx.panel.messages.at(-1), { type: 'fileNodes', requestId: 'cancel', baseVersion: 1, nodes: [] });
    assert.equal(ctx.document.version, 1);
  } finally { await ctx.close(); }
});
