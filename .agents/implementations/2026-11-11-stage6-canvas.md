# 阶段 6：画布交互（多画板 + 平移缩放）（2026-11-11）

- 范围：`specs/canvas-interaction.md` 的五步全部落地——渲染器元数据、视口控制器、画板条、快捷键与持久化、短号聚焦。
- 约束遵守：不给编辑器能力（不改布局），不引入无限画布滚动条，一次看一个文件。

## 变更清单

| 文件 | 内容 |
| --- | --- |
| `src/render/html.ts` | 新增 `nodeBox()`（与 `computeCanvas` 共用几何规则）；`openTag` 支持附加属性；`renderTree` 给每个顶层节点输出 `data-board="1"` + `data-board-name/x/y/w/h` |
| `ui/src/viewport.ts`（新） | 视口纯数学：`zoomAt`（锚点缩放）、`zoomTo`、`fitBox`、`centerOn`、`panBy`、`toCanvas`、`transformCss`、`serialize/parseViewport`；上下限 0.1–4，fit 兜底 0.02 |
| `ui/src/frame-viewport.ts`（新） | 把控制器绑到 iframe 文档：滚轮缩放、空格/中键/空白拖拽平移、拖拽阈值 3px、键盘快捷键、`focusBox` 平滑聚焦、拖拽后吞掉下一次点击 |
| `ui/src/App.tsx` | 工具栏加缩放读数 / 适应 / 1:1；多画板时渲染画板条；视口持久化（300ms 防抖写 localStorage）；短号聚焦改为视口居中；父窗口转发空格与快捷键 |
| `ui/src/styles.css` | `.tools` / `.zoom` / `.boardbar` / `.board` / `.board-size`（全部复用既有 token 与 `.ghost` 风格） |
| `test/fixtures/boards.pen`（新） | 三画板 fixture（含无名画板），供渲染断言与浏览器实测 |
| `test/viewport.spec.ts`（新） | 16 个视口数学用例 |
| `test/render.spec.ts` | 新增 4 个 `data-board*` 断言 |

## 关键设计

1. **变换只在 `.ptr-canvas` 上**：`transform-origin: 0 0` + `translate(tx,ty) scale(z)`，命中检测仍交给浏览器，点击选中不需要改坐标换算。
2. **单一 `applyViewport` 语义**：所有入口（滚轮/拖拽/聚焦/快捷键/恢复）都整体重写 transform，不做增量累加。
3. **拖拽与点击的区分**：位移 < 3px 视为点击；一旦超过阈值，控制器记 `suppressClick`，`mouseup` 后第一次 click 被吞掉，避免「拖画布顺带选中节点」。
4. **聚焦动画**：点击画板/短号时给 canvas 加 180ms transition；滚轮或拖拽立刻清掉 transition，防止动画与手动输入互相拉扯。
5. **短号聚焦的坐标**：`element.getBoundingClientRect()` 与 `.ptr-canvas` 的 rect 同时受 transform 影响，差值再除 `z` 即得画布坐标——不需要逐层累加 offsetParent。

## 过程中修正

- **父页面与 iframe 是两个 document**：空格键状态不会跨文档，焦点在侧栏（点过「清空」之类的按钮）时按空格无效。修法是父窗口 keydown/keyup 也转发到 `ViewportBinding.setSpace`。这一条已同时记入 `FUTURE.md` 的踩坑清单。
- **刷新丢 `?file=`**：`onMount` 恢复深链时直接 `setActiveFile(f)`，不走 `syncUrl`，刷新后 URL 只剩 `?project=`，导致「持久化」看起来不生效。改为走 `openFile(f)`。这是既有缺陷，本次顺带修复。
- **测试脚本自身的坑**：Playwright 的 `locator.boundingBox()` 返回的是主 frame 坐标，不能再叠加 iframe 偏移；先前叠加导致鼠标落在画板外，误判「空格拖拽失效」。

## 证据（2026-11-11）

```text
pnpm check            → root 0 错误
ui tsc --noEmit       → 0 错误
pnpm test             → 10 文件 137 用例全绿（新增 viewport 16 + render 4）
pnpm build            → daemon dist/cli.js 56 kB / ui 28.19 kB
```

浏览器实测（headless Chromium，fixtures/boards.pen，1280×820）：

```text
画板条              → ["全部","首页 800×600","详情 400×300","#ghost 200×200"]
单画板文件          → .boardbar 数量 0（隐藏）
初始 fit            → z=0.732，画布居中（tx=24，ty=148.8）
点击「详情」        → z=2.297，该画板居中（iframe 宽 1000 → 屏心 x=500）
滚轮缩放            → 锚点不动，z 2.30 → 3.60，读数 230% → 360%
Ctrl+0              → 100%；Shift+1 → 回到 73%
空白拖拽            → Δtx=100.0，不产生标记
中键拖拽            → Δtx=60.0，不产生标记
节点拖拽（无空格）  → Δtx=0，按点击处理 → 生成标记
节点拖拽（空格）    → Δtx=120.0，不产生标记
刷新后视口          → z/tx/ty 与刷新前完全一致（230%）
短号聚焦            → 视口平移居中（Δtx=-689，Δty=+298.6）
控制台错误          → 0
```

## 未做 / 后继

- 缩放后的命中精度未做大文档压力测试（DOM 命中由浏览器负责，理论上无需额外处理）。
- 画板名重复时不做去重（回退显示 `#id` 只在名称缺失时生效）。
- 未加「已缩至最小」提示（超出 `specs/canvas-interaction.md` 的必做范围，属可选打磨）。
