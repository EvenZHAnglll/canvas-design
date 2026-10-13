import * as vscode from 'vscode';
import assert from 'node:assert/strict';

interface Diagnostic {
  uri: string;
  ready: boolean;
  nodeCount?: number;
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
    'Canvas Studio is the default .canvas editor',
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
    'PASS: normal .canvas open selected Canvas Studio; 11 nodes, nested Canvas, and local image rendered.',
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
    () => api.getDiagnostics().some((item) => item.uri === uri.toString() && item.nodeCount === 12),
    'Agent source edits were not reflected in the preview',
  );
  console.log('PASS: source / preview toggles and external document edits.');
  const invalid = vscode.Uri.joinPath(root, 'invalid.canvas');
  await vscode.workspace.fs.writeFile(invalid, Buffer.from('{ broken'));
  await vscode.commands.executeCommand('vscode.open', invalid);
  await until(
    () => api.getDiagnostics().some((item) => item.uri === invalid.toString() && item.invalid),
    'Invalid JSON did not display the error state',
  );
  console.log('PASS: invalid JSON opens a recoverable error state.');
}
