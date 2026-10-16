import * as vscode from 'vscode';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { screenshotMaxDimension, screenshotMaxPixels } from './shared/screenshot';

export interface Screenshot {
  png: Uint8Array;
  width: number;
  height: number;
  version: number;
}
export interface ScreenshotResult {
  path: string;
  uri: string;
  width: number;
  height: number;
  version: number;
}
interface Editor {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  refresh(): Promise<void>;
  ready: boolean;
  canonicalPath?: string;
}
interface Pending {
  editor: Editor;
  version: number;
  resolve(value: Screenshot): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export function decodeScreenshot(dataUrl: unknown): Omit<Screenshot, 'version'> {
  if (
    typeof dataUrl !== 'string' ||
    dataUrl.length > 48_000_000 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)
  ) {
    throw new Error('Invalid PNG screenshot response.');
  }
  const png = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (
    png.length < 33 ||
    png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    png.readUInt32BE(8) !== 13 ||
    png.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('Invalid PNG screenshot header.');
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (
    !width ||
    !height ||
    width > screenshotMaxDimension ||
    height > screenshotMaxDimension ||
    width * height > screenshotMaxPixels
  )
    throw new Error('Screenshot dimensions exceed the export limit.');
  return { png, width, height };
}

export class ScreenshotService implements vscode.Disposable {
  private editors = new Map<vscode.WebviewPanel, Editor>();
  private pending = new Map<string, Pending>();

  register(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    refresh: () => Promise<void>,
  ) {
    const editor: Editor = { document, panel, refresh, ready: false };
    this.editors.set(panel, editor);
    void realpath(document.uri.fsPath).then(
      (value) => {
        editor.canonicalPath = value;
      },
      () => {},
    );
  }
  ready(panel: vscode.WebviewPanel) {
    const editor = this.editors.get(panel);
    if (editor) editor.ready = true;
  }
  remove(panel: vscode.WebviewPanel) {
    this.editors.delete(panel);
    for (const [id, pending] of this.pending) {
      if (pending.editor.panel === panel)
        this.finish(id, new Error('The Canvas editor was closed.'));
    }
  }
  receive(
    panel: vscode.WebviewPanel,
    message: { requestId?: string; version?: number; dataUrl?: unknown; error?: string },
  ) {
    const pending = this.pending.get(message.requestId ?? '');
    if (!pending || pending.editor.panel !== panel) return;
    try {
      if (message.error) throw new Error(String(message.error));
      if (
        message.version !== pending.version ||
        pending.editor.document.version !== pending.version
      ) {
        throw new Error('The Canvas changed during export. Please export again.');
      }
      this.finish(message.requestId!, {
        ...decodeScreenshot(message.dataUrl),
        version: pending.version,
      });
    } catch (error) {
      this.finish(message.requestId!, error as Error);
    }
  }
  private finish(id: string, result: Screenshot | Error) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (result instanceof Error) pending.reject(result);
    else pending.resolve(result);
  }
  async capture(uri: vscode.Uri): Promise<Screenshot> {
    if (uri.scheme !== 'file' || !/\.canvas$/i.test(uri.path))
      throw new Error('Choose a local .canvas file.');
    const canonicalPath = await realpath(uri.fsPath);
    const find = () =>
      [...this.editors.values()].find(
        (editor) =>
          (editor.document.uri.toString() === uri.toString() ||
            editor.canonicalPath === canonicalPath) &&
          editor.ready,
      );
    if (!find())
      await vscode.commands.executeCommand('vscode.openWith', uri, 'canvasStudio.editor');
    const deadline = Date.now() + 20_000;
    while (!find()) {
      if (Date.now() > deadline)
        throw new Error(
          'Canvas editor did not become ready. Open the Canvas in VS Code and try again.',
        );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const editor = find()!;
    editor.panel.reveal(undefined, true);
    await editor.refresh();
    const id = randomUUID();
    return new Promise<Screenshot>((resolve, reject) => {
      const pending: Pending = {
        editor,
        version: editor.document.version,
        resolve,
        reject,
        timer: setTimeout(() => this.finish(id, new Error('Screenshot export timed out.')), 30_000),
      };
      this.pending.set(id, pending);
      void editor.panel.webview
        .postMessage({ type: 'captureScreenshot', requestId: id, version: pending.version })
        .then(
          (delivered) => {
            if (!delivered) this.finish(id, new Error('Unable to reach the Canvas editor.'));
          },
          (error) => this.finish(id, new Error(String(error))),
        );
    });
  }
  async save(uri: vscode.Uri, destination?: vscode.Uri): Promise<ScreenshotResult | undefined> {
    destination ??= await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(uri.fsPath.replace(/\.canvas$/i, '.png')),
      filters: { 'PNG image': ['png'] },
      title: 'Export Canvas screenshot',
    });
    if (!destination) return;
    if (!/\.png$/i.test(destination.path)) throw new Error('Choose a .png destination.');
    const screenshot = await this.capture(uri);
    await vscode.workspace.fs.writeFile(destination, screenshot.png);
    return {
      path: destination.fsPath,
      uri: destination.toString(),
      width: screenshot.width,
      height: screenshot.height,
      version: screenshot.version,
    };
  }
  dispose() {
    for (const id of this.pending.keys())
      this.finish(id, new Error('Canvas Design was deactivated.'));
    this.editors.clear();
  }
}
