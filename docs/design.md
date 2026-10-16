# Canvas Design 设计约定

## 目标

在 VS Code 编辑器内预览和编辑 `.canvas`，通过同一份可读 JSON 文件，让开发者与 AI Agent 交换设计方案。首版优先验证本地文件工作流，提供轻量原型设计能力。

## 文件格式

使用 JSON Canvas 1.0 的 `nodes` 和 `edges`，支持 `text`、`file`、`link`、`group` 四种标准节点。位置、尺寸、连线和文件引用均使用标准字段。未知字段在编辑后保留。

视觉扩展放在节点的 `canvasStudio` 对象中：`shape` 为 `rectangle` 或 `ellipse`，`fill`、`stroke` 使用 `#RRGGBB` 或含透明度的 `#RRGGBBAA`，`radius`、`fontSize` 为数字。标准 `color` 字段仍只接受 JSON Canvas 的 1–6 或六位十六进制颜色。图形仍是标准 `text` 节点，其他阅读器可以显示其文本。扩展字段的完整视觉效果需要本插件。

Details 的 Fill、Stroke 各保持单行当前色值和圆形色样。点击色样打开浮动取色面板，面板内显示低饱和度预设色、透明色快捷选项，以及 R/G/B（0–255）与 A（0–1）数值输入。弹层使用原生 Popover 顶层，不受侧栏滚动容器裁切；点击外部、关闭按钮或 Escape 关闭，切换检查对象也会关闭。改色及文档确认期间保持弹层打开。预设色使用不透明颜色；透明选项保留 RGB 并将 A 设为 0。颜色修改保存为八位十六进制，画布与嵌套 SVG 预览共用颜色解析。旧分组的六位填充色保留原有约 31% 的不透明度；显式八位颜色直接使用其 alpha，不再叠加默认透明度。界面以两位小数显示 A，文件保留八位颜色的 alpha 精度。

Details 的 X、Y、W、H、圆角和字号数值悬停时显示左右箭头指针；按住鼠标左键横向拖动，每像素调整 1 个单位，并实时预览画布。宽高不低于 20，圆角范围 0–256，字号范围 1–256；位置允许负数。松开只提交一次版本化编辑，沿用文档撤销和重做。单击仍可直接输入；Escape、失焦、指针取消、检查对象或文档变化会取消未提交的拖动。

PNG 和 `.canvas` 文件节点直接显示引用内容，不绘制节点背景、边框、阴影或圆角，透明像素及引用画布中的空白区域透出下层内容；嵌套 Canvas 预览遵循同一规则。引用画布保留自身节点的外观，不额外添加卡片或内容内边距。已有样式字段仍保留在文件中，但这些引用节点不应用卡片外观，也不显示对应的属性控件。选中轮廓和调整尺寸的手柄仅用于编辑。

节点数组从后到前决定层叠关系，Outliner 以相反顺序显示同级图层，顶部代表最前层。渲染器显式使用节点数组下标作为层级，并关闭自动层级调整；选中节点不会改变其遮挡关系。

嵌套 Canvas 使用 `file` 节点，`file` 指向另一个 `.canvas`。父画布保留引用，不复制子节点。预览按子画布的内容边界缩放，双击进入被引用的文件编辑。检测循环引用，最多展开四层。文件路径先相对当前 Canvas 解析，再尝试工作区根目录；只访问当前 Canvas 目录或已打开的工作区。

## HTML 片段节点

HTML 是编辑器中的独立类别，但保存为标准 `text` 节点。`text` 保存供其他 JSON Canvas 阅读器显示的备用文字，`canvasStudio.type` 为 `html`，`canvasStudio.html`、`canvasStudio.css` 分别保存 HTML 片段与样式；不新增顶层节点类型，不要求完整 HTML 文件。未知扩展字段仍按原样保留。扩展中的 HTML 缺失或不是字符串时显示备用文字，非法 CSS 不影响标准 Canvas 文档的打开。

工具栏的 **<> HTML fragment**（`U`）支持点击或拖动创建节点。Details 分别编辑 HTML、CSS、Fallback text，离开字段后通过版本化编辑协议提交，沿用保存、撤销和重做；双击卡片聚焦 HTML 编辑区。节点支持原有位置、尺寸、层级、复制和连线操作。示例见 `examples/html-card.canvas`。

`src/webview/html-preview.ts` 从 inert template 重建允许的静态 HTML 元素与属性，过滤脚本、事件、导航、iframe、SVG、图片和其他资源入口。CSS 经浏览器 CSSOM 解析，只保留普通样式、`@media` 和 `@supports`，过滤 URL、转义资源函数、import 和字体资源，不允许选择 shadow host。每个预览使用独立 Shadow DOM，外层固定尺寸、裁切并使用 CSS containment，保持作者颜色和样式不受编辑器主题影响；表单控件只展示，不接受交互。原始 HTML/CSS 保存在文件中，过滤仅发生在展示时，Webview CSP 不放宽。

嵌套 Canvas 的 SVG foreignObject 使用相同渲染器。截图先将每个实际 HTML 预览栅格化为有尺寸限制的 PNG，再放进画布的离屏副本，避免 Shadow DOM 在复制或 SVG 序列化时丢失；不改变实时视口。

`pnpm test:browser` 使用临时 Chrome/Chromium 配置和私有调试管道验证内容过滤、样式隔离、创建、属性编辑、源码同步、撤销重做、嵌套显示和 PNG 像素。可用 `CHROME_EXECUTABLE` 指定浏览器，`CANVAS_BROWSER_QA_PATH` 保留编辑器 UI 截图；该检查与 `pnpm check`、真实 VS Code 集成测试分别运行。

## 编辑器架构

- `src/extension.ts`：注册 `CustomTextEditorProvider`，负责 VS Code 文档、文件选择、资源访问、源码切换。
- `src/shared/`：JSON Canvas 校验、编辑操作和消息类型。
- `src/webview/main.ts`：DOM 界面、左侧 Outliner、右侧 Details、工具栏与编辑会话。
- `src/webview/color-field.ts`：预设色板与 RGBA 数值控件；`src/shared/colors.ts` 提供安全的十六进制颜色转换。
- `src/webview/number-field.ts`：Details 数值拖动的指针捕获、预览、提交与取消。
- `src/webview/flow.tsx`：React Flow 画布、对象交互、连线与嵌套 SVG 预览。
- `src/webview/flow-nodes.ts`：同步节点时明确提供宽高并保留已有测量值，避免连续预览清空尺寸后触发整屏隐藏与重新测量。
- `src/webview/style.css`：三栏布局与 VS Code 主题配色。
- `src/webview/screenshot.ts` 与 `src/shared/screenshot.ts`：离屏复制实际画布 DOM、移除编辑辅助控件，计算完整画布边界并导出有尺寸限制的 PNG。导出不改变当前视口。
- `src/screenshot.ts`：版本化截图请求、PNG 校验与保存；`src/screenshot-bridge.ts` 和 `scripts/capture-canvas.mjs`：通过工作区内的文件队列让本地终端 Agent 自动请求截图，详见 [截图自动化](screenshots.md)。
- `src/screenshot-command.ts`：根据插件安装目录和当前 Canvas 所属工作区生成可复制的终端命令，对 shell 参数进行转义，让其他项目直接调用 VSIX 内的截图脚本。

VS Code 文本文档是唯一数据源。画布编辑通过 `WorkspaceEdit` 修改文档，沿用保存、撤销和重做。操作带文档版本，拒绝过期写入；AI Agent 或源码编辑改变文件时刷新画布。损坏的 JSON 显示错误并提供源码入口，不自动覆盖文件。

画布导航使用 React Flow 的滚动平移与捏合缩放：普通滚动（包括 macOS 触控板双指滑动）按原始滚动距离平移两个坐标轴；双指捏合或展开缩放。保留 Space/中键拖动平移和工具栏缩放按钮。滚动与捏合只改变视口，不修改 Canvas 节点或文档。

Webview 占满编辑器区域，不添加重复的 header。Outliner 位于左侧，Details 独占右侧，两栏独立滚动；源码按钮位于画布右下角。界面颜色直接使用 `--vscode-*` 主题变量，原生控件的 `color-scheme` 跟随 VS Code 注入的主题类，因此切换主题无需重载。主题只影响编辑器界面和视口辅助元素，不修改文件中的对象颜色。

两侧面板可通过标题栏中的按钮独立收起，隐藏后不占布局宽度，分别由画布左上角和右上角的小图标恢复。收起只隐藏原有 DOM，保留内容、选中状态和滚动位置；面板显隐状态与视口一起保存到 Webview 状态，不写入 Canvas 文件。按钮提供名称、展开状态和键盘焦点切换；工具栏为角落的恢复按钮留出空间。

## 首版范围

支持移动、缩放视图、节点拖动和调整大小、文本、圆角矩形、圆形、分组、图片、文件引用、嵌套 Canvas、连线和样式编辑。后续再增加自动布局、对齐辅助线、组件库、复杂矢量绘制和设计交付能力。
