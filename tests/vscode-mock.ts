import path from 'node:path';
import { readFile, writeFile, stat } from 'node:fs/promises';

export class Uri {
  scheme = 'file';
  constructor(public fsPath: string) {}
  get path() { return this.fsPath; }
  static file(value: string) { return new Uri(path.resolve(value)); }
  static joinPath(base: Uri, ...parts: string[]) { return Uri.file(path.join(base.fsPath, ...parts)); }
  static parse(value: string) { const uri = new Uri(value); uri.scheme = value.split(':')[0]; return uri; }
  toString() { return this.scheme === 'file' ? `file://${this.fsPath}` : this.fsPath; }
}
export class Range { constructor(public start: unknown, public end: unknown) {} }
export class WorkspaceEdit {
  changes: { uri: Uri; text: string }[] = [];
  replace(uri: Uri, _range: Range, text: string) { this.changes.push({ uri, text }); }
}
export class RelativePattern { constructor(public base: Uri, public pattern: string) {} }
export const FileType = { File: 1, Directory: 2 };
export const disposable = () => ({ dispose() {} });
export class Document {
  version = 1;
  constructor(public uri: Uri, private text: string) {}
  getText() { return this.text; }
  positionAt(offset: number) { return offset; }
  async save() { await writeFile(this.uri.fsPath, this.text); return true; }
  setText(text: string) { this.text = text; this.version++; changeListeners.forEach(callback => callback({ document: this })); }
}
type Listener = (event: { document: Document }) => void;
let changeListeners: Listener[] = [];
export let registeredProvider: { resolveCustomTextEditor(document: unknown, panel: unknown): Promise<void> };
export const executed: { id: string; args: unknown[] }[] = [];
export const commandHandlers = new Map<string, (...args: any[]) => unknown>();
export const window = {
  activeTextEditor: undefined,
  createOutputChannel() { return { info() {}, error() {}, dispose() {} }; },
  registerCustomEditorProvider(_type: string, provider: typeof registeredProvider) { registeredProvider = provider; return disposable(); },
  async showOpenDialog() { return undefined; },
  async showSaveDialog() { return undefined; },
};
export const commands = {
  registerCommand(id: string, callback: (...args: any[]) => unknown) { commandHandlers.set(id, callback); return disposable(); },
  async executeCommand(id: string, ...args: unknown[]) { executed.push({ id, args }); },
};
export const env = { async openExternal(uri: Uri) { executed.push({ id: 'openExternal', args: [uri] }); return true; } };
export const workspace = {
  workspaceFolders: [] as { uri: Uri }[],
  textDocuments: [] as Document[],
  fs: {
    async readFile(uri: Uri) { return readFile(uri.fsPath); },
    async writeFile(uri: Uri, bytes: Uint8Array) { await writeFile(uri.fsPath, bytes); },
    async stat(uri: Uri) { const info = await stat(uri.fsPath); return { type: info.isFile() ? FileType.File : FileType.Directory, size: info.size }; },
  },
  async applyEdit(edit: WorkspaceEdit) {
    for (const change of edit.changes) {
      const doc = workspace.textDocuments.find(item => item.uri.toString() === change.uri.toString());
      if (!doc) return false;
      doc.setText(change.text);
    }
    return true;
  },
  onDidChangeTextDocument(callback: Listener) { changeListeners.push(callback); return { dispose() { changeListeners = changeListeners.filter(item => item !== callback); } }; },
  createFileSystemWatcher() { return { dispose() {}, onDidChange: disposable, onDidCreate: disposable, onDidDelete: disposable }; },
};
export class Panel {
  active = true;
  messages: any[] = [];
  private receiver?: (message: unknown) => unknown;
  private close?: () => void;
  webview = {
    options: {}, html: '', cspSource: 'https://resource.test',
    asWebviewUri: (uri: Uri) => ({ toString: () => `https://resource.test${uri.fsPath}` }),
    postMessage: async (message: unknown) => { this.messages.push(message); return true; },
    onDidReceiveMessage: (callback: (message: unknown) => unknown) => { this.receiver = callback; return disposable(); },
  };
  onDidChangeViewState() { return disposable(); }
  onDidDispose(callback: () => void) { this.close = callback; return disposable(); }
  async send(message: unknown) { await this.receiver?.(message); }
  dispose() { this.close?.(); }
}
export function reset() { changeListeners = []; workspace.textDocuments = []; workspace.workspaceFolders = []; executed.length = 0; commandHandlers.clear(); }
