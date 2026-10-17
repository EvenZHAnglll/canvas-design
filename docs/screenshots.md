# Canvas screenshots

## Export from the editor

Use **Export PNG** in the bottom-right status controls, the camera icon in the editor title, or **Canvas Design: Export Screenshot** in the command palette. Choose a PNG destination in the save dialog.

The screenshot uses the actual rendered nodes, connections, local images, and expanded nested Canvas previews. It includes the complete node bounds with 32 units of padding, regardless of the current zoom or pan. It uses the current theme's canvas background and excludes sidebars, tools, selection outlines, resize handles, connection handles, and inline editors. Export does not change the viewport, selection, document, or undo history.

Exports use up to 2 pixels per canvas unit, reducing scale for large canvases to stay below 4096 pixels per side and 16 megapixels. Empty canvases produce a background image. Finish an active edit first. Invalid JSON, unavailable images, editor closure, and document changes during capture return errors instead of saving a stale screenshot.

## Request a screenshot from a terminal

The target folder must already be open in a local VS Code window with Canvas Design enabled. The extension activates after startup to handle screenshot requests, and opens the requested Canvas editor if needed. No MCP setup or network server is required.

The VSIX includes the screenshot script. The project being edited does not need this development repository or its source files. To obtain a ready-to-run command, right-click the target `.canvas` in Explorer and choose **Canvas Design: Copy AI Screenshot Command**. The command is also available in the command palette and the Canvas editor's title overflow menu. It resolves all paths from the installed extension and the Canvas's workspace folder, including multi-root workspaces. The copied command uses POSIX quoting on macOS/Linux and PowerShell quoting on Windows. It requires Node.js on `PATH` and works regardless of the terminal's current directory. Copy it again after updating or relocating the extension.

AI agents can find the installation automatically using the VS Code `code` CLI. On macOS/Linux, from the other project's root:

```sh
node "$(code --locate-extension EvenSo.canvas-design)/scripts/capture-canvas.mjs" ./design.canvas
```

Replace `./design.canvas` with the desired file. This lookup needs `code` on `PATH` and the same VS Code installation/profile that has Canvas Design installed; use the copy command for a custom installation. For VS Code Insiders, use `code-insiders` instead of `code`.

Alternatively, invoke the installed script by its absolute path. Pass the Canvas path relative to the terminal's current directory or as an absolute path, and pass the folder open in VS Code with `--workspace`. If omitted, the workspace defaults to the current directory. For source development with `examples/` open, the repository script still works:

```sh
node scripts/capture-canvas.mjs examples/prototype.canvas --workspace examples
```

The script prints one JSON object:

```json
{
  "path": "/project/.canvas-design/screenshots/<request-id>.png",
  "width": 2048,
  "height": 1200,
  "version": 5
}
```

An AI agent can edit the `.canvas`, run the script, wait for success, and use its image-reading tool on `path` to assess the result. The script waits up to 60 seconds. Errors have a nonzero exit code. It removes request/response records afterward and retains the PNG. Add `.canvas-design/` to the target project's `.gitignore` if screenshots should stay local.

### File protocol

For agents that cannot run Node.js, the same protocol can be implemented with ordinary file operations:

1. Create a UUID and write `.canvas-design/screenshots/<uuid>.request.json` under an open workspace folder, using a temporary file and atomic rename.
2. Its JSON body is `{"canvas":"relative/path/to/file.canvas"}`. Canvas paths must resolve inside that workspace, including symlink checks. There is no caller-supplied output path.
3. Wait for `<uuid>.result.json`. Success contains `path`, `width`, `height`, and `version`; failure contains `error`. PNGs use the same UUID. The extension serializes requests and creates outputs exclusively, without replacing existing files.
4. Read the PNG, then remove the request and result JSON files.

The protocol is local to each workspace. It does not send files to an AI service; the calling agent chooses which image-reading tool to use. Changes to the open workspace folder list require reloading the extension window to register bridge watchers for the new folders.

## VS Code command and extension API

Other VS Code extensions can export without a save dialog:

```ts
const result = await vscode.commands.executeCommand(
  'canvasDesign.exportScreenshot',
  vscode.Uri.file('/project/design.canvas'),
  vscode.Uri.file('/project/design.png'),
);
```

The promise returns `{ path, uri, width, height, version }` after the PNG is written. Omitting the destination opens the save dialog; cancellation returns `undefined`. The activated extension API also provides `exportScreenshot(canvasUri, destinationUri)`. The extension identity is `EvenSo.canvas-design`.
