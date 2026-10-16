import * as vscode from 'vscode';
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isWithin } from './shared/paths';
import type { CanvasNode } from './shared/canvas';

/** Validate the entire batch before returning standard file-reference nodes. */
export async function prepareFileNodes(
  documentPath: string,
  workspacePaths: string[],
  uris: unknown,
  x: unknown,
  y: unknown,
): Promise<CanvasNode[]> {
  if (
    !Array.isArray(uris) ||
    !uris.length ||
    uris.length > 100 ||
    !uris.every((uri) => typeof uri === 'string')
  ) {
    throw new Error('Choose between 1 and 100 local files.');
  }
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isSafeInteger(Math.round(x)) ||
    !Number.isSafeInteger(Math.round(y))
  ) {
    throw new Error('The file insertion position is invalid.');
  }
  const directories = [path.dirname(documentPath), ...workspacePaths];
  const canonicalRoots = await Promise.all(
    directories.map((directory) => realpath(directory).catch(() => directory)),
  );
  const files: string[] = [];
  const seen = new Set<string>();
  for (const value of uris) {
    const uri = vscode.Uri.parse(value, true);
    if (uri.scheme !== 'file' || uri.fsPath.includes('\0'))
      throw new Error('Only local file references can be added.');
    const canonical = await realpath(uri.fsPath);
    const rootIndex = canonicalRoots.findIndex((root) => isWithin(root, canonical));
    if (rootIndex === -1)
      throw new Error('Choose files inside this Canvas directory or an open workspace.');
    if (!(await stat(canonical)).isFile())
      throw new Error('Folders cannot be added as file nodes.');
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    // Map canonical /private/var paths (or workspace aliases) back into the
    // opened workspace so the relative reference also passes lexical checks.
    const target = directories.some((root) => isWithin(root, uri.fsPath))
      ? uri.fsPath
      : path.join(directories[rootIndex], path.relative(canonicalRoots[rootIndex], canonical));
    files.push(path.relative(path.dirname(documentPath), target).split(path.sep).join('/'));
  }
  return files.map((file, index) => {
    const left = Math.round(x) + index * 32;
    const top = Math.round(y) + index * 32;
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(top))
      throw new Error('The file insertion position is invalid.');
    return { id: randomUUID(), type: 'file', file, x: left, y: top, width: 420, height: 300 };
  });
}
