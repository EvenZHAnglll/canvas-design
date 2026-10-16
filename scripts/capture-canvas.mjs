import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
if (args.includes('--help') || !args.length) {
  console.log(
    'Usage: node scripts/capture-canvas.mjs <file.canvas> [--workspace <open-workspace-root>]',
  );
  console.log(
    'Keep this workspace open in VS Code with Canvas Design enabled. Prints the PNG path as JSON.',
  );
  process.exit(args.includes('--help') ? 0 : 1);
}
const canvasArg = args[0];
if (args.length !== 1 && (args.length !== 3 || args[1] !== '--workspace'))
  throw new Error('Invalid arguments. Use --help.');
const workspace = await realpath(path.resolve(args[2] ?? process.cwd()));
const canvas = await realpath(path.resolve(canvasArg));
const relative = path.relative(workspace, canvas);
if (
  relative === '..' ||
  relative.startsWith(`..${path.sep}`) ||
  path.isAbsolute(relative) ||
  !/\.canvas$/i.test(canvas)
) {
  throw new Error('Choose a .canvas file inside the specified workspace.');
}
const directory = path.join(workspace, '.canvas-design', 'screenshots');
await mkdir(directory, { recursive: true });
const canonicalDirectory = await realpath(directory);
const relativeDirectory = path.relative(workspace, canonicalDirectory);
if (
  relativeDirectory === '..' ||
  relativeDirectory.startsWith(`..${path.sep}`) ||
  path.isAbsolute(relativeDirectory)
) {
  throw new Error('The screenshot directory must stay inside the workspace.');
}
const id = randomUUID();
const request = path.join(directory, `${id}.request.json`);
const temporary = path.join(directory, `${id}.tmp`);
const response = path.join(directory, `${id}.result.json`);
try {
  await writeFile(temporary, JSON.stringify({ canvas: relative }), { flag: 'wx' });
  await rename(temporary, request);
  const deadline = Date.now() + 60_000;
  for (;;) {
    let result;
    try {
      result = JSON.parse(await readFile(response, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    if (result) {
      if (result.error) throw new Error(result.error);
      console.log(JSON.stringify(result));
      break;
    }
    if (Date.now() > deadline)
      throw new Error(
        'Screenshot timed out. Open this workspace in VS Code with Canvas Design enabled, then retry.',
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
} finally {
  await Promise.all([temporary, request, response].map((file) => rm(file, { force: true })));
}
