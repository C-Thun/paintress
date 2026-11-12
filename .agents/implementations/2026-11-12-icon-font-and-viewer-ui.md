# 2026-11-12 — icon_font 兼容 + 查看器品牌/画布背景/i18n

## 需求（operator 原话）

1. 「所有该放 icon 的地方是一个虚线框」——真实设计稿（Alice Chat，`repos/andares/alice/pencil-new.pen`）里的图标全部渲染成占位框。
2. 「左上角的 logo 图标面积放大一倍，周围不需要空这么多，右边 paintress 的字样用主色」。
3. 「画布区右上角增加 dark/light/gray 的样式切换……只改画布区的背景色……轻微立体的凹槽横条，圆形 handle 可以有效拖动+点击，左边文字显示当前的样式名称，英文就行」。
4. 「这个东西要加语言切换，支持中英切换……同样切换按钮在右上角，支持检测浏览器设置的语言，不是中文就是英文」。
5. 「先记一些计划进 future」——项目级预设与组件体系（见 `FUTURE.md#画谱`）。

## 变更

### 1. `.pen` 的 `icon_font` 节点被当作未知类型

**根因**：上游文件用 `type: "icon_font"` + `iconFontName` / `iconFontFamily` 表示图标（Alice 稿 41 个节点全部是这种写法），而 paintress 只认自己定义的 `type: "icon"` + `icon` / `library`。未知类型走 `KNOWN_RENDER_TYPES` 的兜底分支 → `placeholderBox()`，标签是 `${type}: ${name}`，于是满屏 `icon_font: logoIcon` 虚线框。

**修复**（不是换图标，是认字段名）：

- `src/schema/nodes.ts`：新增 `IconFontSchema`（`iconFontFamily` / `iconFontName` / `weight` / `fill`，passthrough），`KNOWN_NODE_TYPES` 增 `icon_font`，`SCHEMA_BY_TYPE` 登记。
- `src/render/html.ts`：`case 'icon'` 与 `case 'icon_font'` 合并；`icon_font` 取 `iconFontFamily`→library、`iconFontName`→icon；缺 family 按 `lucide`。
- `format/spec.yaml`：`nodes.icon_font` 条目，注明与 `icon` 等价、2026-11-12 起识别。
- 图标名全部命中 lucide-static，无需替换（实测 25 个名字 0 缺失）。

**证据**：`test/fixtures/icon-font.pen` + `test/render.spec.ts` 的 3 个用例（SVG 内联 / 缺 family 兜底 / 名字不存在仍出占位框+警告）。真实稿 `node dist/cli.js render` 全量渲染 `warnings: []`，截图 41 个图标全部正常。

### 2. 查看器侧栏品牌

- `.brand-mark`：`22×22` → `height: 32px; width: auto`。
  旧写法的问题不是「小」，是**比例错配**：logo 是 540×942（竖长 0.573），塞进正方形盒后 `preserveAspectRatio` 把它压成 12.6×22 并左右留白 4.7px —— 这就是「周围空这么多」。定高不宽后盒即图形，可见面积约 ×2.
- `.sidebar-head h1` 加 `color: var(--accent)`（主色 `#205080`，与 logo 蓝同源）。

### 3. 画布背景切换（新组件 `ui/src/canvas-bg.tsx`）

- 三档 Light / Gray / Dark，只改**舞台底色 + iframe 文档底色**（`--canvas-bg` / `--ptr-canvas-bg`），侧栏、工具条、画板条不动。
- 轨道用 inset 双层阴影做凹槽、滑块用外阴影 + 顶部高光做浮起；滑块内核有一个 11px 圆点显示当前画布色。
- 拖动：pointer capture + `posFromPointer()` 连续换算，松手取整并提交；点击同样走 pointerdown/up；方向键可切。
- 行程用 `ResizeObserver` 实测轨道宽度算 `--step`，CSS 与 JS 不各写一份常数。
- 无设计稿打开时不接管舞台底色（保持原本米白），否则空界面会变白板。

### 4. 中英 i18n（`ui/src/i18n.ts`）

- `Messages` 接口 + `Record<Lang, Messages>`，**键一致性由 tsc 保证**，不需要额外的键对齐测试。
- 默认 `navigator.languages[0] ?? navigator.language`，`zh*` → 中文，其余（含 ja、无语言信息）→ 英文；手动切换后写 `localStorage.paintress:lang` 并优先。
- 工具条右上角 中/EN 段控；同时把 `document.documentElement.lang` 跟着切。
- 为让两个切换器常驻，`<main>` 里的工具条从「有文件才渲染」提到外层，空界面只留切换器。

## 与既有约定的关系

- **没有新增格式语义**：`icon_font` 是上游 `.pen` 本来就有的节点类型，本次是补识别，不是 `.ptr` 扩展（D-006 的 pen 层仍冻结）。
- **新增组件 1 个**：`ui/src/canvas-bg.tsx`。查过现有代码：`ui/src/` 下没有可复用的开关/段控组件，`.toggle` 只是一个 checkbox 标签，撑不起拖动 + 三档 + 英文标签的需求。
- 语言切换是 6 行段控，直接内联在 `App.tsx`，不再单开组件。

## 验证

- `pnpm check` 双端 0 错误；`pnpm build` 通过（daemon + ui）。
- `pnpm test` **181 通过**（原 178 + 新增 3）。
- 全量跑出现过一次 `test/changes.spec.ts` 时序失败，单跑与重跑全绿 → 既有 flake，已按 `FUTURE.md` 的触发条件在该条目下记了状态（未修）。
- 视觉验证：临时静态服务器 + 假 API 渲染真实 `demo/hello.ptr`，四种状态各截图（en/light、en/dark、en/gray、zh/light）；验证完删除临时文件。

## 未做

- 画谱（预设/组件体系）只落计划，未写代码，见 `FUTURE.md#画谱（Album）— 项目级预设与组件体系（2026-11-12 拟定）`。
- 语言与画布背景的选择没有做 URL 参数（只有 localStorage），暂不支持分享带主题的深链。

## 后续微调（同日）

- dark 底色 `#1a1f26` → `#242b36`：operator 反馈纯黑与米白界面反差过大，改微亮微蓝的深蓝灰。
