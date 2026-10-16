# Canvas Design

A VS Code extension for visually editing [JSON Canvas](https://jsoncanvas.org/spec/1.0/) files alongside your code. Sketch layouts, connect ideas, and keep design references in your repository. The same readable `.canvas` file can be edited visually, as JSON, or by a coding agent.

**Early MVP.** Install from source for now; the extension is not published on the VS Code Marketplace.

## Features

- Text, rectangles, ellipses, groups, and connections, with drag, resize, and property editing.
- Local images and nested Canvas references. PNG transparency and referenced canvases display without an extra background, border, or rounded corners.
- An Outliner for layers and groups, and a Details inspector. Hide either panel and restore it from its corner icon.
- Click a fill or stroke color circle in Details to open muted presets, a transparent option, and RGBA controls (RGB 0–255, alpha 0–1).
- VS Code save, undo, redo, and JSON source editing, with previews that refresh after external edits.
- Trackpad navigation and support for light, dark, and high-contrast editor themes.
- Full-canvas PNG export, plus a terminal script that lets AI agents request the editor's rendering.

Try the [example dashboard](examples/prototype.canvas), or start with an [empty canvas](examples/empty.canvas).

## Install

Requires VS Code **1.95+**. Building requires Node.js **22+**, pnpm **10+**, and the system `zip` command.

```sh
git clone https://github.com/EvenZHAnglll/canvas-design.git
cd canvas-design
pnpm install --frozen-lockfile
pnpm package
```

In VS Code, run **Extensions: Install from VSIX…** and select `dist/canvas-vscode-0.1.0.vsix`, then run **Developer: Reload Window**. The package filename follows the version in `package.json`.

## Usage

Open a `.canvas` file, or run **Canvas Design: Create Canvas**. If it opens as text, use **Reopen Editor With… → Canvas Design**.

- Choose a tool, then click or drag to draw. Select an object to move, resize, or edit its properties. Double-click text to edit it.
- In connection mode, drag between node handles to connect objects.
- Drag items in **Outliner** to reorder layers or move them into groups. Higher layers appear in front. Moving or deleting a group also affects its descendants.
- Use the image and Canvas buttons to insert local references. Double-click a referenced canvas to edit it. References must stay within the current canvas directory or an open workspace.
- Collapse either sidebar with its heading arrow; use the top-left or top-right icon to restore it.
- Drag a numeric value in **Details** left or right to adjust it with a live preview. Click to type a value, or press Escape during a drag to cancel.
- Use the **</>** button or **Canvas Design: Open JSON Source** to edit the source directly.
- Click **Export PNG** at the bottom right, or run **Canvas Design: Export Screenshot**, to save the full canvas with its images and nested previews.

| Action                                       | Shortcut or gesture                                        |
| -------------------------------------------- | ---------------------------------------------------------- |
| Select / pan                                 | `V` / `H`                                                  |
| Rectangle / ellipse / text / group / connect | `R` / `O` / `T` / `G` / `C`                                |
| Pan / zoom                                   | Scroll, Space-drag, or middle-button drag / trackpad pinch |
| Fit all objects                              | `F`                                                        |
| Select multiple / duplicate                  | Shift-click / Cmd/Ctrl+D                                   |
| Delete                                       | Delete or Backspace                                        |

## Limitations

Text is plain text; Markdown rendering is not supported. Images fit within their bounds without cropping. Nested previews expand up to four levels; file `subpath` values are preserved but not expanded. Automatic layout, component overrides, collaboration, and frontend code export are not available yet.

## Screenshots for AI agents

Install the VSIX and open any local project in VS Code. Right-click its `.canvas` file and choose **Canvas Design: Copy AI Screenshot Command**, or run that command from the palette. Paste the command into a terminal or give it to your AI agent. It includes the installed script, Canvas, and workspace paths, and works from any directory (macOS/Linux shells, or PowerShell on Windows).

An agent can also locate the installed script automatically with the VS Code `code` CLI. From the project folder on macOS/Linux:

```sh
node "$(code --locate-extension canvas-studio.canvas-vscode)/scripts/capture-canvas.mjs" ./design.canvas
```

The screenshot script is included in the VSIX; the target project does not need this repository or a script copy. Keep its workspace open in VS Code. `--workspace` must match an open folder; omit it when the current directory is that folder. The command waits for rendering and prints JSON containing the PNG `path`, pixel dimensions, and document version. The agent can then open that image. PNGs are kept in the workspace's `.canvas-design/screenshots/` directory.

Screenshots contain the full canvas without editor controls, at up to 2× resolution (limited to 4096 pixels per side and 16 megapixels). See [automation details](docs/screenshots.md) for the local request protocol and VS Code command API.

## Development and contributions

Run `pnpm install --frozen-lockfile`, open this repository in VS Code, and press **F5** with **Run Canvas Design** selected. Open `prototype.canvas` in the development window. After changes, run `pnpm build` and reload that window, or use `pnpm watch` while developing.

Run `pnpm check` before submitting a change. `pnpm test:integration` also checks the extension in a real desktop VS Code window. Architecture and file-format notes are in [docs/design.md](docs/design.md).

[Bug reports](https://github.com/EvenZHAnglll/canvas-design/issues) and focused pull requests are welcome. Include reproduction steps and a small `.canvas` example for bugs; add screenshots for UI changes.

## License

[MIT](LICENSE). Built with React and React Flow. Bundled dependencies use MIT, ISC, and BSD-3-Clause licenses; their copyright and license texts are preserved in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) and included in the VSIX.
