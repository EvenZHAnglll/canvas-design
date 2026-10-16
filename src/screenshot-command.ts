import path from 'node:path';

/** Quote every path for the shell used by the copied terminal command. */
export function screenshotCommand(
  extensionPath: string,
  canvasPath: string,
  workspacePath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const windows = platform === 'win32';
  const script = (windows ? path.win32 : path.posix).join(
    extensionPath,
    'scripts',
    'capture-canvas.mjs',
  );
  const quote = (value: string) =>
    windows ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\"'\"'")}'`;
  return `node ${quote(script)} ${quote(canvasPath)} --workspace ${quote(workspacePath)}`;
}
