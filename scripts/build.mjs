import { build, context } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
const options = [
  { entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], sourcemap: true, target: 'node20' },
  { entryPoints: ['src/webview/main.ts'], outfile: 'dist/webview.js', bundle: true, platform: 'browser', format: 'iife', sourcemap: true, target: 'es2022', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } },
];
if (process.argv.includes('--watch')) {
  for (const option of options) await (await context(option)).watch();
  console.log('Watching extension, webview, and CSS…');
} else {
  await Promise.all(options.map(option => build(option)));
  console.log('Built Canvas Studio.');
}
