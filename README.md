# Canvas Studio

**Design on a canvas. Keep it in your codebase.**

Canvas Studio is a VS Code extension for opening and editing `.canvas` files as visual documents. Use it to sketch UI layouts, map ideas, connect diagrams, and keep design references beside the code they describe.

The canvas is stored as readable [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/). You can edit it visually, review changes in Git, or ask an AI coding agent to update the same file. Changes to the source are reflected in the visual editor.

Canvas Studio is currently an early MVP. The repository supports local development and installation from a VSIX package; Marketplace publishing is not configured yet.

## What you can do

- **Build lightweight prototypes:** add text, rectangles, ellipses, groups, and connections. Move and resize objects, then edit their appearance in the Details panel.
- **Keep references in your project:** insert local images, link files, and embed other `.canvas` files as nested previews.
- **Organize a scene:** use the left-hand Outliner to select objects, expand groups, reorder layers, and move objects into or out of groups. The right-hand Details panel is dedicated to properties.
- **Work inside VS Code:** open `.canvas` files directly in the visual editor, switch to JSON source, and use the editor's save, undo, and redo workflow.
- **Navigate with a trackpad:** two-finger scrolling pans the canvas; pinching zooms. Space-drag and middle-button dragging also pan.
- **Match your editor:** the interface follows VS Code's light, dark, and high-contrast themes while preserving the colors in your design.

The [dashboard example](examples/prototype.canvas) includes shapes, metric cards, a local SVG chart, a [referenced component](examples/components/share-card.canvas), and connected design notes. An [empty canvas](examples/empty.canvas) is also included.

## Install from source

### Requirements

- VS Code **1.95 or newer**.
- Node.js **22 or newer** and pnpm **10 or newer** to build the extension.
- The `zip` command to create a VSIX package. It is included with macOS; on other systems, make sure it is available on your `PATH`.

### Build and install

```sh
git clone https://github.com/EvenZHAnglll/canvas-studio.git
cd canvas-studio
pnpm install
pnpm package
```

In VS Code, open the Command Palette, run **Extensions: Install from VSIX…**, and select `dist/canvas-vscode-0.1.0.vsix`.

If the VS Code `code` command is available on your `PATH`, you can install from the terminal instead:

```sh
code --install-extension dist/canvas-vscode-0.1.0.vsix --force
```

Run **Developer: Reload Window**, then open a `.canvas` file. The package filename follows the version in `package.json`.

For extension development, use the [F5 workflow](#development) below to load your local code directly.

## Use the canvas

### Open or create a file

Open an existing `.canvas` file from VS Code's Explorer, or run **Canvas: Create Canvas** from the Command Palette to create one.

If a file opens as text or in another extension, choose **Reopen Editor With… → Configure default editor… → Canvas Studio**. You can also add this association to your user or workspace settings:

```json
{
  "workbench.editorAssociations": {
    "*.canvas": "canvasStudio.editor"
  }
}
```

The extension must be installed or loaded in an Extension Development Host for this association to work.

### Draw, edit, and organize

Choose a shape, text, or group tool, then click or drag on the canvas to create an object. Select an object to move it or resize it with its handles. Use **Details** to change position, dimensions, fill, stroke, corner radius, and text size.

Double-click text to edit it. Press **Cmd/Ctrl+Enter** to finish, or **Escape** to cancel. In connection mode, drag from a node's connection handle to another node. Select a connection and press **Delete** to remove it.

Use the **Outliner** to browse the scene and drag objects to reorder them or change group membership. The top of the Outliner represents the front of the canvas. Dragging a group moves its descendants; deleting a group also removes its descendants and their connections.

Use the chevron in each sidebar heading to hide **Outliner** or **Details** independently and give the canvas more space. Restore them using the small sidebar icons in the canvas's top-left and top-right corners. The editor remembers which panels are hidden; restoring a panel keeps its contents and current selection.

### Add images and nested canvases

The image, Canvas, and file buttons open a local file picker. References must stay within the current canvas directory or an open workspace. Paths are resolved relative to the current `.canvas` file first, then relative to workspace roots.

PNG and `.canvas` file nodes have no background, border, shadow, or rounded corners. PNG transparency and empty areas in referenced canvases show the layers underneath, including in nested Canvas previews. Referenced canvases keep their own node styles, without an extra card or inset around their content. These nodes retain selection outlines and resize handles; their Details panel omits card appearance controls.

Nested canvases show a preview of the referenced file. Double-click one to open its source canvas for editing. Changes to the child file refresh its parent preview.

### Switch between the canvas and JSON

Use the editor title-bar actions, the **</>** button at the bottom-right of the canvas, or these commands:

- **Canvas: Open Visual Editor**
- **Canvas: Open JSON Source**

Visual edits update the VS Code text document. Source and external file changes refresh the canvas; stale visual edits are rejected to avoid overwriting newer changes. Invalid JSON shows an error with a source-editor entry point.

### Navigation and shortcuts

| Action                             | Gesture or shortcut                                               |
| ---------------------------------- | ----------------------------------------------------------------- |
| Select / pan tool                  | `V` / `H`                                                         |
| Rectangle / ellipse / text / group | `R` / `O` / `T` / `G`                                             |
| Connection mode                    | `C`                                                               |
| Pan                                | Two-finger scroll, mouse wheel, Space-drag, or middle-button drag |
| Zoom                               | Trackpad pinch or the `+` / `−` buttons                           |
| Fit the canvas                     | `F`                                                               |
| Select multiple objects            | Shift-click                                                       |
| Select all / duplicate             | Cmd/Ctrl+A / Cmd/Ctrl+D                                           |
| Move selected objects              | Arrow keys; hold Shift for larger steps                           |
| Delete selection                   | Delete or Backspace                                               |
| Save                               | Cmd/Ctrl+S                                                        |
| Undo / redo                        | Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z                                     |

## File format and AI workflows

Canvas Studio uses the standard JSON Canvas `text`, `file`, `link`, and `group` nodes and `edges`. Visual styles and group hierarchy metadata are stored in a `canvasStudio` extension object. Unknown fields are preserved when editing.

For example, this is a complete canvas containing a rounded button:

```json
{
  "nodes": [
    {
      "id": "primary-button",
      "type": "text",
      "x": 40,
      "y": 40,
      "width": 180,
      "height": 48,
      "text": "Continue",
      "canvasStudio": {
        "shape": "rectangle",
        "fill": "#eee9ff",
        "stroke": "#7762e5",
        "radius": 12,
        "fontSize": 16
      }
    }
  ],
  "edges": []
}
```

`shape` can be `rectangle` or `ellipse`. A nested canvas uses a standard `file` node pointing to a path such as `components/share-card.canvas`. Other JSON Canvas readers can read the standard fields; Canvas Studio's additional visual styles require support for its extensions.

An AI agent with access to your project can read and edit these files directly. For example:

> Open `examples/prototype.canvas`, add a fourth metric card, and adjust the existing cards to fit. Preserve existing node IDs, file references, and unknown metadata.

Keep node IDs stable, use integer coordinates and positive dimensions, and retain fields the agent does not understand. Images and nested canvases remain file references, so their source files can be maintained independently.

Image generation experiments can use the file's layout and content as input to an external image tool. Canvas Studio currently provides the editable canvas; built-in image generation and pixel-exact reproduction by image models are outside its current scope.

## Development

The project uses **TypeScript**, **React**, **React Flow**, and **esbuild**. VS Code's text document is the source of truth, with a Webview providing the visual editor.

### Run and debug with F5

1. Clone the repository and run `pnpm install` as shown above.
2. Open the repository root in VS Code.
3. Press **F5** with **Run Canvas Studio** selected.
4. In the new **Extension Development Host** window, open `prototype.canvas` from the `examples/` workspace.

The launch configuration builds the extension before starting. It loads the local project directly, so there is no need to package or reinstall a VSIX for each change.

For continuous compilation, run this in the project terminal:

```sh
pnpm watch
```

After a change finishes compiling, run **Developer: Reload Window** in the Extension Development Host. You can set breakpoints in the extension's TypeScript source. To inspect the Webview's DOM, styles, and browser console, run **Developer: Open Webview Developer Tools** while the canvas is active. Extension logs appear in the **Canvas Studio** Output channel.

### Commands and validation

| Command                 | Purpose                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `pnpm build`            | Bundle the extension and Webview into `dist/`.                         |
| `pnpm watch`            | Rebuild automatically when source files change.                        |
| `pnpm typecheck`        | Check source and tests with TypeScript.                                |
| `pnpm test`             | Run Node.js unit tests and extension tests using a mocked VS Code API. |
| `pnpm check`            | Run type checking, unit/mocked-extension tests, and a build.           |
| `pnpm test:integration` | Build and run integration tests in a real VS Code extension host.      |
| `pnpm format`           | Format the configured source and documentation files with Prettier.    |
| `pnpm format:check`     | Check formatting without changing files.                               |
| `pnpm package`          | Build and create a local VSIX using the system `zip` command.          |

`pnpm check` does not include formatting or real VS Code integration tests. Integration tests cover default canvas opening, Webview rendering, images and nested canvases, source synchronization, and invalid-JSON recovery. They require a desktop environment and a VS Code executable.

The integration runner uses a temporary profile and a copy of the examples. It detects the default macOS VS Code installation, or uses `code` from `PATH`. To choose another executable:

```sh
VSCODE_EXECUTABLE="/path/to/code" pnpm test:integration
```

### Project layout

```text
src/
  extension.ts       VS Code custom editor, document edits, and resource access
  shared/            Canvas format, edit sessions, hierarchy, and path rules
  webview/           React Flow renderer, Outliner, Details, and theme styles
scripts/             Build, packaging, and test runners
tests/               Unit, mocked-extension, and VS Code integration tests
examples/            Sample canvases, nested components, and image assets
docs/                Architecture and format notes
output/imagegen/     Image-generation comparison artifacts and prompts
.vscode/             Debug configuration, build task, and editor association
```

See [AGENTS.md](AGENTS.md) for contributor conventions and [docs/design.md](docs/design.md) for architecture notes, currently written in Chinese.

## Current limitations

- Text is displayed as plain text; Markdown rendering is not implemented.
- File `subpath` values are preserved but not expanded.
- Nested canvas previews expand up to four levels and detect circular references. Edit nested content by opening its source file.
- Images are fitted to their bounds; cropping and freeform vector drawing are not available.
- Automatic layout, alignment guides, component instance overrides, multiplayer collaboration, and frontend code export are not implemented.

## Contributing

Bug reports and focused improvements are welcome through [GitHub Issues](https://github.com/EvenZHAnglll/canvas-studio/issues) and pull requests. For bugs, include reproduction steps and a small `.canvas` example when possible.

For code changes, run the relevant checks, add regression coverage for behavior changes, and include screenshots for UI changes. Describe any desktop or manual checks you could not perform. Keep generated bundles, local logs, and VSIX packages out of commits.

## License

[MIT](LICENSE)
