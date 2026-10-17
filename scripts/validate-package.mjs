import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Use decimal kB so the check also fits a Marketplace limit expressed as 1024 kB.
const maxIconBytes = 1_024_000;

export async function validatePackageIcon(root, icon) {
  if (typeof icon !== 'string' || !icon.toLowerCase().endsWith('.png')) {
    throw new Error('The extension icon must be a PNG file.');
  }
  const file = path.resolve(root, icon);
  const info = await stat(file);
  if (!info.isFile() || info.size > maxIconBytes) {
    throw new Error(`The extension icon must be a file no larger than ${maxIconBytes} bytes.`);
  }
  const png = await readFile(file);
  if (
    png.length < 33 ||
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.readUInt32BE(8) !== 13 ||
    png.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('The extension icon must have a valid PNG header.');
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width < 128 || width !== height) {
    throw new Error('The extension icon must be square and at least 128 x 128 pixels.');
  }
  console.log(`Validated icon: ${width} x ${height}, ${png.length} bytes.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = process.cwd();
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    await validatePackageIcon(root, manifest.icon);
  } catch (error) {
    console.error(`Package validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
