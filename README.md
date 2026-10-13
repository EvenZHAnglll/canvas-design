# Canvas Studio

在 VS Code 编辑器中打开、预览和编辑 `.canvas`，用同一份 JSON Canvas 文件同步开发者与 AI Agent 的设计方案。

## 开发与运行

需要 Node.js 22+、pnpm 和 VS Code 1.95+。

```sh
pnpm install
pnpm build
pnpm check
```

用 VS Code 打开本目录，按 **F5** 启动 `Run Canvas Studio`。扩展开发窗口会打开 `examples/` 工作区；点击 `prototype.canvas` 查看示例。修改代码后运行 `pnpm build` 并重新加载扩展开发窗口；持续编译使用 `pnpm watch`。

没有配置 Marketplace 发布；`publisher` 是本地开发占位值。

## 安装到日常使用的 VS Code

F5 只会在扩展开发窗口加载插件。要在普通 VS Code 窗口直接打开 `.canvas` 预览，先构建并安装本地扩展：

```sh
pnpm package
code --install-extension dist/canvas-vscode-0.1.0.vsix --force
```

打包使用 `scripts/package.mjs`，需要系统的 `zip` 命令（macOS 自带），无需下载打包工具。安装也可通过 VS Code 扩展面板的 **Install from VSIX…** 选择生成的文件完成。安装后执行 **Developer: Reload Window**，再打开任意 `.canvas` 文件，即可默认进入 Canvas Studio。

项目及示例工作区已在 `.vscode/settings.json` 中显式配置 `workbench.editorAssociations`。如果其他工作区已有覆盖设置，请在其设置中将 `"*.canvas"` 关联到 `"canvasStudio.editor"`，或通过 **Reopen Editor With… → Configure default editor… → Canvas Studio** 设置默认编辑器。需要编辑 JSON 时，可点击画布右下角的 **</>** 源码按钮。

## 使用

- `.canvas` 默认在图形编辑器打开。VS Code 编辑器右上角切换源码/预览，画布右下角的 **</>** 按钮也可打开 JSON。需要时通过 VS Code 的 **Reopen Editor With…** 选择编辑器。
- 界面直接使用 VS Code 的编辑器区域，不额外显示 header；左侧 **Outliner** 管理对象层级，右侧 **Details** 使用整栏高度显示属性，两栏分别滚动。
- 界面自动跟随 VS Code 当前的浅色、深色及高对比度主题，切换主题即时生效。对象自身的填充、描边及图片内容保留设计文件中的颜色。
- 命令面板执行 **Canvas: Create Canvas** 创建空白文件。
- 工具栏选择矩形、圆形、文本或分组，点击或拖动空白区域创建。圆形工具可以绘制椭圆，等宽高时为圆形。
- 选择对象后拖动位置，拖动右下角手柄调整尺寸，右侧面板修改坐标、尺寸、颜色和圆角。双击文本编辑，`Ctrl/Cmd+Enter` 完成。
- 图片、Canvas 和文件工具打开本地文件选择器。文件必须位于当前 Canvas 所在目录或已打开的工作区内。嵌套 Canvas 显示其内容，双击进入子文件编辑；保存子文件会刷新父画布。
- **C** 进入连线模式，依次点击两个对象。点击连线后可删除。**Shift+点击** 多选，**Ctrl/Cmd+D** 复制，**Delete** 删除；拖动分组会移动完全包含在其中的对象。
- 触控板双指滑动平移画布（支持横向、纵向和斜向），双指捏合或展开缩放；鼠标滚轮也用于平移。**Space+拖动** 或中键拖动平移，工具栏 **+/−** 缩放，**F** 适配画布。**Ctrl/Cmd+S** 保存，沿用 VS Code 的撤销和重做。

## 文件格式与 AI Agent

使用 [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) 的标准 `text`、`file`、`link`、`group` 节点和 `edges`。保留未知字段。路径先相对当前 `.canvas` 解析，再相对工作区根目录解析。

圆形与视觉样式使用 `text` 节点的 `canvasStudio` 扩展：

```json
{
  "id": "primary-button",
  "type": "text",
  "x": 40,
  "y": 40,
  "width": 180,
  "height": 48,
  "text": "继续",
  "canvasStudio": {
    "shape": "rectangle",
    "fill": "#eee9ff",
    "stroke": "#7762e5",
    "radius": 12,
    "fontSize": 16
  }
}
```

`shape` 可为 `rectangle` 或 `ellipse`。引用子画布使用标准 `file` 节点，例如 `"file": "components/button.canvas"`；不用复制子文件内容。AI Agent 应保留稳定的节点 ID、标准字段以及不认识的扩展字段。源码或外部文件改动会刷新预览，过期画布操作会被拒绝，防止覆盖新版本。

## 当前边界

这是轻量原型 MVP。文本按纯文本显示，尚未渲染 Markdown；文件 `subpath` 保留但不展开。嵌套 Canvas 最多展开四层，检测循环引用，嵌套预览需进入子文件编辑。图片为适配显示，暂不提供裁剪和自由矢量绘制。暂不支持自动布局、组件实例覆盖、多人协作或导出前端代码。

## 目录与验证

- `src/extension.ts`：VS Code 文档与 Webview 桥接。
- `src/shared/`：格式校验、编辑操作、样式与路径规则。
- `src/webview/`：画布交互、SVG 连线和属性面板。
- `tests/`：Node.js 测试；`pnpm test`。
- `docs/design.md`：架构及兼容约定；`examples/`：原型与嵌套示例。

`pnpm typecheck` 检查 TypeScript；`pnpm check` 执行类型检查、测试和构建。
