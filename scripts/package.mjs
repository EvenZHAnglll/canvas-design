import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

// Offline local packaging. Runtime dependencies are already bundled by esbuild.
// Requires the zip CLI (included in macOS and commonly available on Linux).
const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'dist', `${manifest.name}-${manifest.version}.vsix`);
const staging = await mkdtemp(path.join(os.tmpdir(), 'canvas-studio-package-'));
const xml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character],
  );

try {
  await mkdir(path.join(staging, 'extension', 'dist'), { recursive: true });
  for (const file of [
    'package.json',
    'README.md',
    'LICENSE',
    'dist/extension.cjs',
    'dist/webview.js',
    'dist/webview.css',
  ]) {
    await copyFile(path.join(root, file), path.join(staging, 'extension', file));
  }
  await writeFile(
    path.join(staging, '[Content_Types].xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="cjs" ContentType="application/javascript" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="md" ContentType="text/markdown" />
  <Override PartName="/extension/LICENSE" ContentType="text/plain" />
</Types>
`,
  );
  await writeFile(
    path.join(staging, 'extension.vsixmanifest'),
    `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(manifest.name)}" Version="${xml(manifest.version)}" Publisher="${xml(manifest.publisher)}" />
    <DisplayName>${xml(manifest.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(manifest.description)}</Description>
    <License>extension/LICENSE</License>
    <Tags>canvas,visualization</Tags>
    <Categories>${xml(manifest.categories.join(','))}</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(manifest.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
  </Assets>
</PackageManifest>
`,
  );
  // Remove the previous archive so zip cannot retain obsolete package entries.
  await rm(output, { force: true });
  const result = spawnSync(
    'zip',
    ['-q', '-r', output, '[Content_Types].xml', 'extension.vsixmanifest', 'extension'],
    { cwd: staging, stdio: 'inherit' },
  );
  if (result.error) throw new Error(`Packaging requires the zip CLI: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`zip failed with exit code ${result.status}`);
  console.log(`Packaged ${path.relative(root, output)}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
