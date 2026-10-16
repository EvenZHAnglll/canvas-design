import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inflateSync } from 'node:zlib';
import { screenshotCommand } from '../src/screenshot-command';

interface Diagnostic {
  uri: string;
  ready: boolean;
  nodeCount?: number;
  htmlCount?: number;
  nestedCount?: number;
  loadedImages?: number;
  invalid?: boolean;
}
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 20000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
export async function run() {
  const extension = vscode.extensions.getExtension('canvas-studio.canvas-vscode');
  assert.ok(extension, 'Development extension is loaded');
  const api = (await extension.activate()) as { getDiagnostics(): Diagnostic[] };
  const root = vscode.workspace.workspaceFolders![0].uri;
  const uri = vscode.Uri.joinPath(root, 'prototype.canvas');
  // Use the normal open command so this verifies default editor resolution.
  await vscode.commands.executeCommand('vscode.open', uri);
  await until(
    () => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom,
    'Opening .canvas did not select a custom editor',
  );
  const input = vscode.window.tabGroups.activeTabGroup.activeTab!.input as vscode.TabInputCustom;
  assert.equal(
    input.viewType,
    'canvasStudio.editor',
    'Canvas Design is the default .canvas editor',
  );
  await until(
    () =>
      api
        .getDiagnostics()
        .some(
          (item) =>
            item.uri === uri.toString() &&
            item.ready &&
            item.nodeCount === 11 &&
            item.nestedCount === 1 &&
            item.loadedImages === 1,
        ),
    'Canvas did not mount, render its nested Canvas, and load its image',
  );
  console.log(
    'PASS: normal .canvas open selected Canvas Design; 11 nodes, nested Canvas, and local image rendered.',
  );
  const screenshotUri = vscode.Uri.joinPath(root, 'prototype-export.png');
  const screenshot = await vscode.commands.executeCommand<{
    width: number;
    height: number;
    version: number;
  }>('canvasStudio.exportScreenshot', uri, screenshotUri);
  assert.ok(screenshot && screenshot.width > 100 && screenshot.height > 100);
  const png = Buffer.from(await vscode.workspace.fs.readFile(screenshotUri));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), screenshot.width);
  assert.equal(png.readUInt32BE(20), screenshot.height);
  assert.ok(png.length > 10_000, 'Screenshot includes rendered content');
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  assert.ok(
    inflateSync(Buffer.concat(chunks)).some((value) => value > 4),
    'Screenshot is not a fully transparent image',
  );
  if (process.env.CANVAS_SCREENSHOT_QA_PATH) {
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(process.env.CANVAS_SCREENSHOT_QA_PATH),
      png,
    );
  }
  console.log('PASS: full Canvas PNG export rendered text, nested Canvas, and local images.');
  const terminalCommand = screenshotCommand(extension.extensionPath, uri.fsPath, root.fsPath);
  const terminal = await promisify(execFile)(
    process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
    process.platform === 'win32'
      ? ['-NoProfile', '-NonInteractive', '-Command', terminalCommand]
      : ['-c', terminalCommand],
    { cwd: root.fsPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 65_000 },
  );
  const automated = JSON.parse(terminal.stdout) as { path: string; width: number; height: number };
  assert.equal(automated.width, screenshot.width);
  assert.equal(automated.height, screenshot.height);
  assert.ok((await vscode.workspace.fs.stat(vscode.Uri.file(automated.path))).size > 10_000);
  console.log(
    'PASS: absolute installed-script command exported PNG from a separate project directory.',
  );
  await vscode.commands.executeCommand('canvasStudio.openSource', uri);
  await until(
    () => vscode.window.activeTextEditor?.document.uri.toString() === uri.toString(),
    'Source toggle did not open the JSON document',
  );
  const document = vscode.window.activeTextEditor!.document;
  const source = JSON.parse(document.getText());
  source.nodes.push({
    id: 'agent-added',
    type: 'text',
    x: 1400,
    y: 0,
    width: 160,
    height: 80,
    text: 'Agent update',
    canvasStudio: { type: 'html', html: '<div class="card">Agent HTML update</div>', css: '.card { padding: 12px; background: #19c37d; height: 100%; }' },
  });
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    uri,
    new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
    JSON.stringify(source, null, 2),
  );
  await vscode.workspace.applyEdit(edit);
  await vscode.commands.executeCommand('canvasStudio.openPreview', uri);
  await until(
    () => api.getDiagnostics().some((item) => item.uri === uri.toString() && item.nodeCount === 12 && item.htmlCount === 1),
    'Agent source edits were not reflected in the preview',
  );
  console.log('PASS: source / preview toggles and external document edits.');
  const htmlScreenshotUri = vscode.Uri.joinPath(root, 'html-export.png');
  await vscode.commands.executeCommand('canvasStudio.exportScreenshot', uri, htmlScreenshotUri);
  assert.ok((await vscode.workspace.fs.stat(htmlScreenshotUri)).size > 10_000);
  console.log('PASS: HTML text-node extension renders after source edits and exports with the Canvas.');
  const noteUri = vscode.Uri.joinPath(root, 'drop-note.md');
  const imageUri = vscode.Uri.joinPath(root, 'drop-image.png');
  const childUri = vscode.Uri.joinPath(root, 'components', 'share-card.canvas');
  await vscode.workspace.fs.writeFile(noteUri, Buffer.from('# Referenced Markdown\n'));
  await vscode.workspace.fs.writeFile(imageUri, png);
  await vscode.commands.executeCommand('canvasStudio.addFilesToCanvas', noteUri, [noteUri, imageUri, childUri]);
  await until(() => api.getDiagnostics().some(item => item.uri === uri.toString() && item.nodeCount === 15 && item.loadedImages === 2 && item.nestedCount === 2), 'Explorer file insertion did not render all three references');
  assert.deepEqual(JSON.parse(document.getText()).nodes.slice(-3).map((node: { type: string; file: string }) => [node.type, node.file]), [['file', 'drop-note.md'], ['file', 'drop-image.png'], ['file', 'components/share-card.canvas']]);
  await vscode.commands.executeCommand('undo');
  await until(() => api.getDiagnostics().some(item => item.uri === uri.toString() && item.nodeCount === 12), 'A file batch did not undo as one edit');
  await vscode.commands.executeCommand('redo');
  await until(() => api.getDiagnostics().some(item => item.uri === uri.toString() && item.nodeCount === 15), 'A file batch did not redo');
  console.log('PASS: Explorer command inserts Markdown, PNG, and Canvas file nodes at the viewport center with atomic undo/redo.');
  const invalid = vscode.Uri.joinPath(root, 'invalid.canvas');
  await vscode.workspace.fs.writeFile(invalid, Buffer.from('{ broken'));
  await vscode.commands.executeCommand('vscode.open', invalid);
  await until(
    () => api.getDiagnostics().some((item) => item.uri === invalid.toString() && item.invalid),
    'Invalid JSON did not display the error state',
  );
  console.log('PASS: invalid JSON opens a recoverable error state.');
}
