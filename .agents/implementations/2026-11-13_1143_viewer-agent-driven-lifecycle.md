# 2026-11-13T11:43+08:00 — 查看器改成 agent 驱动：路径式项目 URL、自动开浏览器、实时增删与倒计时关闭、画板条滚轮 + 渐隐、主题/自动尺寸等兼容性修复

- `sanitizeProjectName` 允许 `/`，`deriveProjectName` 直接返回 `父/自身`（`c-thun/raybend`），不再压成 `c-thun-raybend`。
- 路由按**最长前缀**解析项目：`/c-thun/raybend`、`/render/c-thun/raybend/design/editor.pen`、`/files/c-thun/raybend/...` 都能裸 `/` 命中，文件仍用 `?file=` 传。
- 前端 `syncUrl` 写路径形式；旧的 `?project=` 深链仍能读，读进来后回写成新形式。
- CLI 修了一个真 bug：`paintress watch <name> <dir>` 之前把相对目录原样发给 daemon，由 daemon 的 cwd 解析 —— 在别的目录敲命令会报「目录不存在」。

## 2. 进程不自动退出：找到根因

`autoRegister` 拉起 daemon 时写死 `--idle 3600000`（1 小时），而 idle 判定只看「项目是否 idle」，浏览器关掉只是让项目回到 idle 状态，仍要等满 1 小时。

新的生命周期策略（daemon 侧，默认值）：

| 状态 | 结果 |
| --- | --- |
| 有 agent attach | 一直活着 |
| 无 agent + 浏览器开着 + 有项目 | 一直活着 |
| 无 agent + 浏览器开着 + 项目归零（曾经有过） | 前端 10s 倒计时关；服务端 30s 兜底 |
| 无 agent + 浏览器开着 + 从未有过项目（人手动起） | 10 分钟后收（不催人） |
| 无 agent + 无浏览器 + 有手动 watch 项目 | `idleTimeout`（默认 60s） |
| 无 agent + 无浏览器 + 无项目 | 3s |

「浏览器还在」的判据是 SSE 连接 **且** 最近 30s 有 HTTP 请求 —— 标签页冻结/关掉都会同时失效。

## 3. 实时联动与倒计时

- 注册表 SSE 事件改成带**全量项目信息**（name/label/fileCount/agentConns…），前端同一帧完成增删，不用再等一次接口往返。
- `attach` / `detach` 也推事件，agent 上下线立刻反映。
- 项目行：新增滑入 220ms，消失压缩淡出 240ms；数据没变时复用行对象，避免每次事件整列重播动画。
- 无激活项目 → 遮罩 + 「无激活项目 / 窗口将在 X 秒后关闭」+ 进度条，10s 后 POST `/api/shutdown`、显示「服务已关闭」并尝试 `window.close()`；期间项目回来就撤销倒计时。服务端关闭前先推 `shutdown` 事件，页面因此停在一个说得通的画面上，而不是网络错误。
- agent 首次拉起 daemon 时自动开浏览器并落在自己的项目：`openBrowser()` + `projectUrl()`；`PAINTRESS_NO_OPEN=1`、CI、无 DISPLAY 时自动跳过。`paintress web` 手动起也会开，并给了 60s 空仓宽限。

## 4. 兼容性（这一批）

- **主题/密度**：节点的 `theme: {mode, density}` 沿子树继承，变量取对应主题项（更具体的匹配优先）。修了一处闭包 bug：`lookup` 绑在根主题上，`withTheme` 换的 scope 实际没生效 —— 之前 main.pen 里 8 张浅色板全渲染成深色。
- **自动尺寸**：Pencil 里 frame 高度由内容撑开，文件里没有 height。截图改为进浏览器**量真实盒子**再裁剪（`main.pen` 的 `库设置 W1 · 浅色宽松` 板高 0 → 实测 1080×637，出图正常）；查看器的画板列表也用实测几何，跳转会框准。
- **文本渐变填充** → `background-clip: text`（不再退化成首色）。
- **strokeAlignment**：outer/center 改用 `outline`（inner 仍用 border），不再一律按 inner 画。
- **径向渐变** 支持 `center` / `size`。
- **`enabled:false` 的填充层**跳过（描边同理）。
- **图标**：Material Symbols 走 lucide 别名表（delete_forever→trash-2、schedule→clock 等），editor.pen 的渲染警告从 80+ 条降到 0。

## 5. 交互与视觉

- 右上角 **Canvas 背景** 与 **语言** 改成扁平分段控件（1px 边 + 6px 圆角 + 底色，与 `.ghost` / `.board` 同一套面子），去掉凹槽/渐变滑块；`canvas-bg-math.ts` 与它的单测随之删除（不再有拖拽）。
- **画板条**：「全部」固定在左侧不参与滚动；右侧列表支持滚轮横向滚；每个 frame 名固定 132px 宽，溢出部分用 10px 渐隐收边（不用省略号）。

## 验证

- `pnpm check` 干净；`pnpm test` **246 passed**（新增主题/密度、文本渐变、outer 描边、fill enabled、图标别名、生命周期、路径路由、URL 拼装等用例）。
- 真实稿子：`main.pen` 的浅色宽松板从上到下都是浅色（与 `design/exports/storage-recovery-w1/LuuTs.png` 对得上）；`editor.pen` 各板警告清零。
- 真浏览器验证（Playwright）：`/c-thun/raybend?file=design/editor.pen` 自动进项目；35 个画板可滚轮横滚（scrollLeft 0→600）；解绑 → 行退场 → 倒计时 9s → 自动关服 → 页面停在「服务已关闭」；重新 watch → 倒计时消失、行滑回。控制台无错误。

## 已知待定（留给后续）

`linear-gradient` 的 `rotation` 基准仍有矛盾证据：`Fade / 左段 + 右段底纹` 这一对支持「0 指向上、逆时针」，`ToolsBar Left + Right 渐隐覆盖` 那一对支持「0 指向上、顺时针」，`流光带（从左往右扫）` 则更像「0 指向右」。当前按 `format/spec.yaml` 的逆时针实现，改动点是 `penAngleToCss` 一行。
