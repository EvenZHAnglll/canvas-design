import * as vscode from 'vscode';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { applyOperation, parseCanvas, serializeCanvas, type AssetPreview, type CanvasData, type CanvasState, type Operation } from './shared/canvas';
import { canExpandCanvas, isWithin, referenceCandidates } from './shared/paths';

const viewType = 'canvasStudio.editor';
const imagePattern = /\.(png|jpe?g|webp|gif|svg|bmp|avif)$/i;

export function activate(context: vscode.ExtensionContext) {
  const provider = new CanvasEditor(context);
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(viewType, provider, {
    webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true,
  }));
  context.subscriptions.push(
    vscode.commands.registerCommand('canvasStudio.openPreview', (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri ?? provider.activeUri;
      if (target) return vscode.commands.executeCommand('vscode.openWith', target, viewType);
    }),
    vscode.commands.registerCommand('canvasStudio.openSource', (uri?: vscode.Uri) => {
      const target = uri ?? provider.activeUri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) return vscode.commands.executeCommand('vscode.openWith', target, 'default');
    }),
    vscode.commands.registerCommand('canvasStudio.newCanvas', async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      const uri = await vscode.window.showSaveDialog({ defaultUri: root && vscode.Uri.joinPath(root, 'untitled.canvas'), filters: { 'JSON Canvas': ['canvas'] } });
      if (!uri) return;
      await vscode.workspace.fs.writeFile(uri, Buffer.from('{\n  "nodes": [],\n  "edges": []\n}\n'));
      await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
    }),
  );
  return { getDiagnostics: () => [...provider.diagnostics.values()] };
}

class CanvasEditor implements vscode.CustomTextEditorProvider {
  activeUri?: vscode.Uri;
  readonly diagnostics = new Map<string, { uri: string; ready: boolean; nodeCount?: number; nestedCount?: number; loadedImages?: number; invalid?: boolean }>();
  private edits: Promise<void> = Promise.resolve();
  private readonly output: vscode.LogOutputChannel;
  constructor(private readonly context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel('Canvas Studio', { log: true });
    context.subscriptions.push(this.output);
  }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    this.activeUri = document.uri;
    const editorId = randomUUID();
    this.diagnostics.set(editorId, { uri: document.uri.toString(), ready: false });
    this.output.info('Opening Canvas', document.uri.fsPath);
    const directories = [path.dirname(document.uri.fsPath), ...(vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath)];
    const canonicalRoots = await Promise.all(directories.map(directory => realpath(directory).catch(() => directory)));
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist'), ...[...new Set([...directories, ...canonicalRoots])].map(directory => vscode.Uri.file(directory))],
    };
    panel.webview.html = this.html(panel.webview);
    this.output.info('Webview HTML initialized');
    let generation = 0;
    let disposed = false;
    let referenced = new Set<string>();
    const roots = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);

    const readReference = async (parent: vscode.Uri, reference: string): Promise<vscode.Uri> => {
      const candidates = referenceCandidates(parent.fsPath, reference, roots);
      for (const candidate of candidates) {
        referenced.add(vscode.Uri.file(candidate).toString());
        try {
          const canonical = await realpath(candidate);
          if (!canonicalRoots.some(root => isWithin(root, canonical))) continue;
          const uri = vscode.Uri.file(canonical);
          const info = await vscode.workspace.fs.stat(uri);
          if (info.type === vscode.FileType.File) {
            referenced.add(uri.toString());
            return uri;
          }
        } catch { /* Try workspace-relative paths after document-relative paths. */ }
      }
      throw new Error(`File unavailable or outside the workspace: ${reference}`);
    };

    const readAssets = async (data: CanvasData, parent: vscode.Uri, ancestors: string[], depth: number): Promise<Record<string, AssetPreview>> => {
      const assets: Record<string, AssetPreview> = {};
      await Promise.all(data.nodes.map(async node => {
        const reference = node.type === 'file' ? node.file : node.type === 'group' ? node.background : undefined;
        if (!reference) return;
        try {
          const uri = await readReference(parent, reference);
          if (imagePattern.test(reference)) {
            assets[node.id] = { uri: panel.webview.asWebviewUri(uri).toString() };
          } else if (/\.canvas$/i.test(reference)) {
            const reason = canExpandCanvas(uri.toString(), ancestors, depth);
            if (reason) { assets[node.id] = { error: reason }; return; }
            let open = vscode.workspace.textDocuments.find(item => item.uri.toString() === uri.toString());
            if (!open) {
              // macOS /var aliases and symlinked workspace paths may identify the same document.
              const documents = await Promise.all(vscode.workspace.textDocuments.filter(item => /\.canvas$/i.test(item.uri.path)).map(async item => ({ document: item, canonical: await realpath(item.uri.fsPath).catch(() => item.uri.fsPath) })));
              open = documents.find(item => item.canonical === uri.fsPath)?.document;
            }
            let source: string;
            if (open) source = open.getText();
            else {
              const info = await vscode.workspace.fs.stat(uri);
              if (info.size > 5 * 1024 * 1024) throw new Error('Referenced Canvas exceeds 5 MB.');
              source = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
            }
            const canvas = parseCanvas(source);
            assets[node.id] = { canvas, assets: await readAssets(canvas, uri, [...ancestors, uri.toString()], depth + 1) };
          }
        } catch (error) { assets[node.id] = { error: (error as Error).message }; }
      }));
      return assets;
    };

    const refresh = async () => {
      const ticket = ++generation;
      const version = document.version;
      const state: CanvasState = { type: 'state', version, name: path.basename(document.uri.fsPath) };
      try {
        state.data = parseCanvas(document.getText());
        referenced = new Set();
        const canonical = await realpath(document.uri.fsPath).catch(() => document.uri.fsPath);
        state.assets = await readAssets(state.data, document.uri, [vscode.Uri.file(canonical).toString()], 0);
      } catch (error) { state.error = (error as Error).message; }
      if (!disposed && ticket === generation && version === document.version) await panel.webview.postMessage(state);
    };

    const edit = (operation: Operation, baseVersion: number, requestId: string) => {
      this.edits = this.edits.then(async () => {
        try {
          if (document.version !== baseVersion) throw new Error('The file changed. Your edit was not applied; the latest design has been loaded.');
          const source = document.getText();
          const next = serializeCanvas(applyOperation(parseCanvas(source), operation), source);
          const workspaceEdit = new vscode.WorkspaceEdit();
          workspaceEdit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(source.length)), next);
          if (!await vscode.workspace.applyEdit(workspaceEdit)) throw new Error('VS Code could not apply this edit.');
          const appliedVersion = document.version;
          await refresh();
          await panel.webview.postMessage({ type: 'ack', requestId, version: appliedVersion });
        } catch (error) {
          await refresh();
          await panel.webview.postMessage({ type: 'ack', requestId, error: (error as Error).message });
        }
      }).catch(error => console.error('Canvas Studio edit failed', error));
    };

    const disposables: vscode.Disposable[] = [];
    disposables.push(panel.webview.onDidReceiveMessage(async message => {
      try {
        if (!message || typeof message.type !== 'string') return;
        switch (message.type) {
          case 'ready': this.diagnostics.set(editorId, { uri: document.uri.toString(), ready: true }); this.output.info('Webview ready'); await refresh(); break;
          case 'rendered': {
            const previous = this.diagnostics.get(editorId);
            if (previous) this.diagnostics.set(editorId, { ...previous, nodeCount: message.nodeCount, nestedCount: message.nestedCount, loadedImages: message.loadedImages, invalid: message.invalid });
            break;
          }
          case 'edit':
            if (typeof message.baseVersion === 'number' && typeof message.requestId === 'string' && message.operation) edit(message.operation, message.baseVersion, message.requestId);
            break;
          case 'source': await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default'); break;
          case 'undo': await vscode.commands.executeCommand('undo'); break;
          case 'redo': await vscode.commands.executeCommand('redo'); break;
          case 'save': await document.save(); break;
          case 'insertFile': {
            const selected = await vscode.window.showOpenDialog({
              canSelectMany: false, defaultUri: vscode.Uri.file(path.dirname(document.uri.fsPath)),
              filters: message.kind === 'canvas' ? { 'JSON Canvas': ['canvas'] } : message.kind === 'image' ? { Images: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif'] } : undefined,
            });
            if (!selected?.[0]) return;
            const canonical = await realpath(selected[0].fsPath);
            if (!canonicalRoots.some(root => isWithin(root, canonical))) throw new Error('Choose a file inside this Canvas directory or an open workspace.');
            const file = path.relative(path.dirname(document.uri.fsPath), selected[0].fsPath).split(path.sep).join('/');
            edit({ type: 'addNodes', nodes: [{ id: randomUUID(), type: 'file', file, x: Number.isFinite(message.x) ? Math.round(message.x) : 0, y: Number.isFinite(message.y) ? Math.round(message.y) : 0, width: 420, height: 300 }] }, document.version, randomUUID());
            break;
          }
          case 'openNode': {
            const node = parseCanvas(document.getText()).nodes.find(item => item.id === message.id);
            if (node?.type === 'file' && node.file) {
              const uri = await readReference(document.uri, node.file);
              if (/\.canvas$/i.test(node.file)) await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
              else await vscode.commands.executeCommand('vscode.open', uri);
            } else if (node?.type === 'link' && node.url) {
              const uri = vscode.Uri.parse(node.url);
              if (['https', 'http'].includes(uri.scheme)) await vscode.env.openExternal(uri);
              else throw new Error('Only http and https links can be opened.');
            }
            break;
          }
        }
      } catch (error) { await panel.webview.postMessage({ type: 'notice', message: (error as Error).message }); }
    }));
    disposables.push(vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() === document.uri.toString() || referenced.has(event.document.uri.toString())) void refresh();
    }));
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(document.uri.fsPath)), '**/*'));
    const workspaceWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    const changed = (uri: vscode.Uri) => { if (referenced.has(uri.toString())) void refresh(); };
    for (const item of [watcher, workspaceWatcher]) {
      disposables.push(item, item.onDidChange(changed), item.onDidCreate(changed), item.onDidDelete(changed));
    }
    disposables.push(panel.onDidChangeViewState(() => { if (panel.active) this.activeUri = document.uri; }));
    panel.onDidDispose(() => { disposed = true; generation++; this.diagnostics.delete(editorId); disposables.forEach(item => item.dispose()); });
    // VS Code mounts the webview after this resolver returns. Awaiting postMessage
    // here can deadlock initialization while it waits for that mount.
    void refresh().catch(error => this.output.error('Initial Canvas refresh failed', error));
    this.output.info('Custom editor initialized');
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('hex');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css'));
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <link href="${css}" rel="stylesheet"><title>Canvas Studio</title></head><body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
}
