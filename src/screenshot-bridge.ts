import * as vscode from 'vscode';
import path from 'node:path';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isWithin } from './shared/paths';
import type { Screenshot } from './screenshot';

/** A local file queue lets terminal agents request the editor's actual rendering. */
export function registerScreenshotBridge(
  capture: (uri: vscode.Uri) => Promise<Screenshot>,
): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];
  const handled = new Set<string>();
  let queue = Promise.resolve();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== 'file') continue;
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder.uri, '.canvas-design/screenshots/*.request.json'),
    );
    const run = async (uri: vscode.Uri) => {
      const id = path.basename(uri.fsPath).replace(/\.request\.json$/, '');
      if (!/^[a-f0-9-]{36}$/.test(id) || handled.has(uri.toString())) return;
      handled.add(uri.toString());
      let directory: string | undefined;
      try {
        const root = await realpath(folder.uri.fsPath);
        directory = await realpath(path.join(root, '.canvas-design', 'screenshots'));
        if (
          !isWithin(root, directory) ||
          path.dirname(uri.fsPath) !== path.join(folder.uri.fsPath, '.canvas-design', 'screenshots')
        )
          return;
        const requestPath = await realpath(uri.fsPath);
        if (!isWithin(directory, requestPath)) return;
        if ((await stat(requestPath)).size > 4096)
          throw new Error('Screenshot request is too large.');
        const source = await readFile(requestPath, 'utf8');
        if (source.length > 4096) throw new Error('Screenshot request is too large.');
        const request = JSON.parse(source) as { canvas?: unknown };
        if (typeof request.canvas !== 'string' || path.isAbsolute(request.canvas))
          throw new Error('The Canvas path must be relative to the workspace.');
        const canvas = await realpath(path.resolve(root, request.canvas));
        if (!isWithin(root, canvas) || !/\.canvas$/i.test(canvas))
          throw new Error('Choose a .canvas file inside this workspace.');
        const screenshot = await capture(vscode.Uri.file(canvas));
        const output = path.join(directory, `${id}.png`);
        await writeFile(output, screenshot.png, { flag: 'wx' });
        await writeFile(
          path.join(directory, `${id}.result.json`),
          JSON.stringify({
            path: output,
            width: screenshot.width,
            height: screenshot.height,
            version: screenshot.version,
          }),
          { flag: 'wx' },
        );
      } catch (error) {
        if (directory) {
          // Never follow an existing result symlink or replace an earlier response.
          await writeFile(
            path.join(directory, `${id}.result.json`),
            JSON.stringify({ error: (error as Error).message }),
            { flag: 'wx' },
          ).catch(() => {});
        }
      }
    };
    const schedule = (uri: vscode.Uri) => {
      queue = queue.then(() => run(uri)).catch(() => {});
    };
    disposables.push(watcher, watcher.onDidCreate(schedule), watcher.onDidChange(schedule));
  }
  return {
    dispose() {
      disposables.forEach((item) => item.dispose());
    },
  };
}
