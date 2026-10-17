# Canvas Design 发布 SOP

每次向 VS Code Marketplace 发布或更新，都按本文顺序执行。本文中的命令以仓库根目录、
macOS 的 zsh/bash 为准；每一步检查通过后再进入下一步。本文不执行自动发布。

执行环境需要 Node.js 22+、pnpm 10+、Git，以及 `unzip`、`shasum`；桌面验证需要 VS Code
1.95+ 和 `code` CLI。浏览器检查还需要 Chrome/Chromium。具体环境变量见 [AGENTS.md](../AGENTS.md)。

## 固定信息与完成标准

| 项目                 | 固定值                              |
| -------------------- | ----------------------------------- |
| Publisher ID         | `EvenSo`                            |
| 扩展包名             | `canvas-design`                     |
| 展示名称             | `Canvas Design`                     |
| 完整扩展标识         | `EvenSo.canvas-design`              |
| 命令与编辑器命名空间 | `canvasDesign.*`                    |
| 画布元数据           | `canvasDesign`                      |
| 发布分支             | `main`                              |
| 图标                 | `media/icon.png`                    |
| 上传包               | `dist/canvas-design-<version>.vsix` |

- [商店页面](https://marketplace.visualstudio.com/items?itemName=EvenSo.canvas-design)
- [发布者后台](https://marketplace.visualstudio.com/manage/publishers/EvenSo/extensions/canvas-design/hub)
- [公开源码](https://github.com/EvenZHAnglll/canvas-design)

以上身份信息保持稳定。更新 README、图标或包内文档也需要发布新版本，
GitHub 的 README 修改不会自动同步到商店详情页。

发布完成必须同时满足：源码已推送，检查通过，上传包与验证包一致，商店版本正确且公开，
该版本通过服务端校验，商店安装验证通过，发布记录与 Git tag 指向正确源码。

## 1. 确认本次范围和线上版本

先检查本地改动、分支、远程仓库及商店当前版本：

```sh
git status --short
git branch --show-current
git remote -v
pnpm exec vsce show EvenSo.canvas-design --json
```

- [ ] 明确本次包含哪些功能、修复、文档和资源改动。
- [ ] 检查未跟踪文件，特别是新图标、脚本、测试、CHANGELOG 和文档，避免遗漏。
- [ ] 检查功能分支的改动已按仓库流程合入 `main`，不在不明状态下切换分支或覆盖改动。
- [ ] 记录商店最新版本，确认目标版本未上传过。
- [ ] 不提交 `dist/`、VSIX、`node_modules/`、日志、临时截图、凭据或系统杂项文件。

版本已存在时，先核对是否已成功上传及其校验和，不立即重复上传或删除现有扩展。

## 2. 更新版本、日志和用户文档

手动修改 `package.json` 的 `version`：修复和文档通常升级 patch，新增兼容功能升级 minor，
不兼容改动需明确评估版本与迁移安排。使用普通 `X.Y.Z`，不把 `-beta` 等后缀用于商店版本。
本文以正式版发布为准；预发布渠道需另行明确版本与 `--pre-release` 选项。

把 `CHANGELOG.md` 的待发布条目整理为该版本记录，写清具体变化及必要的兼容性说明。
同步 README 的安装、用法、功能和限制。用户看到的截图必须来自实际编辑器，
不要使用 `output/imagegen/` 中的 UI 设计参考图代替产品截图。

完成版本修改后，在同一个终端中设置本次发布变量：

```sh
canvas_release_version=$(node -p "require('./package.json').version")
canvas_release_vsix="dist/canvas-design-${canvas_release_version}.vsix"
printf 'Version: %s\nVSIX: %s\n' "$canvas_release_version" "$canvas_release_vsix"
```

本文后续命令复用这些变量。终端重新打开后需要重新设置，并重新核对源码提交和包的对应关系。

- [ ] `publisher`、`name`、命令 ID、编辑器 ID 和元数据命名空间保持固定值。
- [ ] 目标版本高于当前正式版，且未被使用。
- [ ] CHANGELOG 包含该版本；README 与实际功能一致。
- [ ] 早期本地开发版数据迁移需求已说明，参见[文件格式约定](design.md)。

## 3. 安装依赖并完成源码检查

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm format:check
pnpm validate:package
pnpm licenses:generate
git diff --check
```

`pnpm check` 包含类型检查、单元/模拟扩展测试和构建。许可证生成必须在构建后运行；
依赖或 bundle 发生变化时，审阅并提交生成的 `THIRD_PARTY_NOTICES.txt`。

`validate:package` 检查 PNG 图标头信息、正方形尺寸和体积：至少 128 × 128，
不超过 1,024,000 字节。推荐使用 512 × 512 的优化 PNG。

如全仓格式检查存在历史欠账，先单独整理并验证格式改动，不能将失败记录为通过，
也不要为了发布把无关的大量格式改动混入功能提交。

按改动范围补充检查：

| 改动类型                                   | 补充验证                                        |
| ------------------------------------------ | ----------------------------------------------- |
| HTML/CSS 渲染、拖放、节点交互、PNG 导出    | `pnpm test:browser`                             |
| 扩展激活、Webview、资源加载、源码同步      | 第 6 步的真实 VS Code 包内集成测试              |
| 拖动、缩放、连线、Outliner、Details 等操作 | 第 6 步的手动验证，包含受影响主题               |
| 提高最低 VS Code 版本或调用新 API          | 核对 `engines.vscode`，在声明的最低支持版本验证 |
| 依赖或打包方式变化                         | 核对许可证、包内文件及第三方通知                |

仅文档或图标改动无需重复无关的浏览器交互检查，但仍需内容、格式、资源和包内检查。
检查失败就修复并重跑相关检查；环境缺失需记录，不能写成已通过。

## 4. 提交并推送发布源码

审阅差异，逐个暂存本次发布所需文件，检查已暂存内容：

```sh
git diff --stat
git diff
git diff --cached
```

确认暂存范围完整后，在 `main` 上提交并推送：

```sh
git commit -m "Prepare release v${canvas_release_version}"
git push origin main
canvas_release_commit=$(git rev-parse HEAD)
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
git status --short
```

- [ ] 本地 `HEAD` 与 `origin/main` 一致，工作区没有未提交或未跟踪的发布文件。
- [ ] GitHub 上已能看到目标版本的清单、图标、源码、示例、文档及许可证。
- [ ] 保存 `canvas_release_commit`，它是后续发布 tag 的目标提交。

官方打包配置把 README 相对链接改写到 GitHub `main`，因此这些文件必须先推送。
没有远程仓库或没有推送权限时，先解决源码同步，再继续正式发布。

## 5. 用官方工具打包并检查内容

```sh
pnpm package:marketplace
unzip -l "$canvas_release_vsix"
unzip -p "$canvas_release_vsix" extension.vsixmanifest
shasum -a 256 "$canvas_release_vsix"
git status --short
```

只使用 `pnpm package:marketplace` 生成上架包。它会验证图标、构建、重新生成许可证，
再由官方 `vsce` 打包。运行时依赖已经打入 bundle，`--no-dependencies` 避免重复打包。

`pnpm package` 是本地离线打包流程，需要系统 `zip`。两种流程目前输出同名文件，
所以正式发布验证期间不能再运行本地打包覆盖上传包。

核对清单和压缩包：

- [ ] Identity 是 `EvenSo` / `canvas-design`，版本等于 `canvas_release_version`。
- [ ] `GalleryFlags` 包含 `Public`，安装目标是 `Microsoft.VisualStudio.Code`。
- [ ] 包含三个运行时 bundle：`extension.cjs`、`webview.js`、`webview.css`。
- [ ] 包含 `scripts/capture-canvas.mjs`、`media/icon.png`。
- [ ] 包含 README、CHANGELOG、MIT LICENSE 和 `THIRD_PARTY_NOTICES.txt`。
- [ ] VSIX 图标资产引用正确；README 的链接指向可访问的公开源码。
- [ ] 不包含开发源码、source map、依赖目录、凭据、日志或生成的参考图。
- [ ] 记录最终 VSIX 的 SHA-256；打包后没有产生尚未提交的许可证或文档变更。

打包引起源码或许可证变化时，返回第 3–4 步处理，再重新打包、验证和计算校验和。

## 6. 验证最终 VSIX

对于应用代码和发布流程改动，在真实桌面 VS Code 中运行：

```sh
CANVAS_INTEGRATION_VSIX="$canvas_release_vsix" pnpm test:integration
```

测试在临时配置与独立工作区中运行包内扩展，覆盖普通 `.canvas` 打开、图片、嵌套 Canvas、
PNG 导出、安装目录中的终端截图脚本、HTML、文件插入、源码同步及损坏 JSON 恢复。
它会重新构建本地 bundle，但读取的是已指定的 VSIX，不会重新打包。

再用一个独立测试项目进行受影响操作的手动验证，必要时安装该包：

```sh
code --install-extension "$canvas_release_vsix" --force
```

- [ ] 创建、打开画布，编辑后保存，撤销和重做。
- [ ] 检查移动、缩放、连线、分组、Outliner 和 Details 中受影响的功能。
- [ ] 检查本地图片、文件引用、嵌套 Canvas、HTML 和 PNG 导出中受影响的功能。
- [ ] 执行 **Copy AI Screenshot Command**，在项目终端确认能生成 PNG。
- [ ] UI 改动检查浅色、深色和高对比主题。

没有桌面环境时，记录自动集成测试不可用，并在有桌面的机器完成相关人工验证。
不能仅凭单元测试宣称 Webview 或桌面交互验证通过。

验证后再次确认包没有变化：

```sh
shasum -a 256 "$canvas_release_vsix"
git rev-parse HEAD
git status --short
```

校验和必须与第 5 步一致，`HEAD` 必须仍为 `canvas_release_commit`。
验证中改了源码，需返回前面步骤，不上传旧包。

## 7. 确认 CLI 身份认证

先验证现有凭据，不必每次重新登录：

```sh
pnpm exec vsce verify-pat EvenSo
```

本机首次登录、PAT 过期或权限发生变化时，再执行：

```sh
pnpm exec vsce login EvenSo
```

PAT 只输入本地终端的隐藏提示，不写入命令参数、项目文件、发布记录或聊天。
创建 PAT 的 Microsoft 身份必须属于 `EvenSo` 的 Owner 或 Contributor。
需要核对 PAT 的 Marketplace → Manage 权限；不能把 Publisher 展示名称当作 ID。

首次创建 PAT 时，进入同一账号的 Azure DevOps 组织，选择 **User settings → Personal access
tokens → New Token**，设置短期有效期，在 **Custom defined → Show all scopes** 中明确勾选
**Marketplace → Manage**。组织范围按照执行时的官方发布指南选择。若尚无组织，先参考
[创建 Azure DevOps 组织](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/create-organization?view=azure-devops)。

PAT 配置、可用范围及认证政策以执行时的微软文档为准，不把旧流程当作永久有效。
截至本 SOP 建立时，官方公告 Azure DevOps 全局 PAT 将于 2026-12-01 退役。
长期自动化优先采用 Microsoft Entra ID。已配置 Entra 认证时，可以使用
`vsce verify-pat --azure-credential EvenSo` 以及发布命令的 `--azure-credential` 选项；
需要先确认该身份确实拥有 Publisher 权限。

也可在[发布者后台](https://marketplace.visualstudio.com/manage)选择已有扩展的 **Update**
上传同一个已验证 VSIX；这种方式不需要 PAT。已有扩展无需再次 **New extension**。

## 8. 上传已验证的包

确认第 1–7 步完成，并再次核对版本、VSIX 路径和 SHA-256 后执行：

```sh
pnpm exec vsce publish --packagePath "$canvas_release_vsix"
```

采用 Entra 认证时，在同一条命令上增加 `--azure-credential`。

必须上传第 6 步验证的文件。`--packagePath` 不重新打包、不自动修改版本，
也不自动创建 Git commit 或 tag。标准流程不使用 `vsce publish patch/minor/major`，
避免在验证后才修改版本和生成不同的包。

保存 CLI 的发布成功信息及 Hub URL。CLI 报成功只说明上传/发布请求已完成，
仍需完成下一步服务端状态和安装检查。

## 9. 检查商店状态并安装商店版

```sh
pnpm exec vsce show EvenSo.canvas-design --json
```

确认以下内容，服务端校验和搜索索引可能需要几分钟：

- [ ] 查询到正确的 Publisher 和扩展名，目标版本存在且为预期的最新正式版。
- [ ] 后台 Availability 为 **Public**，目标版本的校验已通过。
- [ ] `versions` 中目标版本的 `Microsoft.VisualStudio.Services.VsixSha256`
      与本地 VSIX 的 SHA-256 一致，不误读其他版本的校验和。
- [ ] 商店图标、README、更新日志和链接正确。

CLI JSON 的状态字段是位标志：扩展级 `flags` 含 `256` 表示 Public，含 `4` 表示已校验；
目标版本的 `flags` 含 `1` 表示该版本已校验。应检查对应位，不要求整个数字恰好相等，
也不能用扩展整体已校验代替目标版本已校验。

在普通 VS Code 窗口安装商店版：

```sh
code --install-extension EvenSo.canvas-design --force
code --list-extensions --show-versions
```

确认安装的是目标版本；如窗口已打开，执行 **Developer: Reload Window**。
完成创建、编辑、保存、撤销和截图命令的基本验证。若仍获取旧版本，等待分发更新后重试，
不要仅因搜索或 CDN 延迟再升一个版本。

## 10. 创建发布 tag 并记录结果

确认商店目标版本通过验证后，为第 4 步保存的源码提交创建 tag：

```sh
git tag -a "v${canvas_release_version}" "$canvas_release_commit" -m "Release v${canvas_release_version}"
git push origin "refs/tags/v${canvas_release_version}"
```

创建前检查 tag 不存在；已有 tag 时核对其目标，不强制移动或覆盖。
如果另建 GitHub Release，选择同一个 tag，只附上本次校验通过的 VSIX，
发布说明取自对应 CHANGELOG 条目。不要附上原始大图、凭据或无关版本的包。

在 GitHub Release 或本次发布任务中保存下面的记录，不把生成的包或本地日志提交到源码：

```text
版本：
发布日期与时区：
发布者：EvenSo
源码 commit：
Git tag：
VSIX 文件名：
VSIX SHA-256：
源码检查：
格式检查：
图标与许可证检查：
包内集成测试：
浏览器测试或不适用原因：
人工验证范围及结果：
商店 Public / 目标版本校验状态：
商店版安装验证：
商店 URL：
遗留问题：
```

## 常见问题与恢复方式

| 问题                                               | 处理方式                                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PAT 验证提示 `View user permissions on a resource` | 核对后台实际 Publisher ID、Marketplace 与 DevOps 的 Microsoft 身份、Publisher 成员角色、PAT 的 Marketplace → Manage 权限。同邮箱的个人和工作账号可能是不同身份。 |
| 图标超过 1024 kB                                   | 缩小并优化 `media/icon.png`，运行 `pnpm validate:package` 后重新打包；不以 VSIX 总体积判断图标是否超限。                                                         |
| Availability 为 Private                            | 检查上传包中的 Public 标记和后台校验结果，若提供 Make Public 则按后台流程公开；包有 Public 标记不等于服务端已公开。                                              |
| 版本已存在或上传后连接中断                         | 先用 `vsce show` 和后台核对目标版本及 SHA-256。若已经存在且相同，继续验证；不同或需要修改时走新版本，不覆盖既有版本。                                            |
| 本地包与已验证包校验和不同                         | 停止上传，查明是否重打包或被 `pnpm package` 覆盖，重新验证最终文件。                                                                                             |
| README 链接 404、源码版本落后                      | 确认对应文件已提交并推送到 `main`；若包内 README 本身需要修正，发布新版本。                                                                                      |
| 全仓格式检查失败                                   | 清理或单独提交历史格式问题，修复后复查；不把失败隐藏成通过。                                                                                                     |
| CLI 发布成功但搜索不到                             | 查看目标版本的校验、公开及可安装状态，等待索引更新，优先用扩展完整 ID 检查。                                                                                     |
| 新版本存在功能回归                                 | 保留现场与发布记录，修复后以更高版本重新走 SOP；不删除整个扩展、不复用版本号或重写已发布 tag。                                                                   |

本 SOP 只描述正常发布和修复版本流程。删除、下架、转移 Publisher 或强制重写 tag
不是常规恢复步骤，执行前需要单独明确目的和影响。

## 发布前后检查总表

- [ ] 范围、线上版本和目标版本已确认。
- [ ] 版本、CHANGELOG、README 和必要的迁移说明已更新。
- [ ] 类型、测试、构建、格式、图标、许可证及相关补充检查已完成。
- [ ] 发布源码完整提交并推送，记录源码 commit。
- [ ] 官方打包，核对包内身份、资源、文档、Public 标记，记录 SHA-256。
- [ ] 最终包验证完成，源码提交与包校验和未改变。
- [ ] 发布身份认证通过，上传的是同一个 VSIX。
- [ ] 商店版本正确，公开且目标版本校验通过，服务端 SHA-256 一致。
- [ ] 商店版本安装和基本操作通过。
- [ ] tag 已推送，发布记录完整，遗留事项已说明。

## 官方参考

- [VS Code 扩展发布指南](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [扩展清单字段](https://code.visualstudio.com/api/references/extension-manifest)
- [Azure DevOps PAT 管理](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops)
