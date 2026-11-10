# 阶段 4 剩余：嵌套层级切换（2026-11-11）

- 范围：`FUTURE.md#阶段 4 剩余` 的两项——「修饰键点选父级」与「滚轮切换层级」。
- 前置：阶段 6 的视口控制器已完成，命中与导航共用同一层逻辑，不再另造一套。

## 规格冲突与裁决

原条目写的是「**滚轮**切换层级」，但阶段 6（`specs/canvas-interaction.md` §2.1）已经把**普通滚轮**定为以光标为锚点的缩放，两者直接冲突。

裁决：**层级导航让给 Alt+滚轮**，普通滚轮保持缩放。

- 理由 1：滚轮缩放是画布交互的核心手势，改动它代价最大。
- 理由 2：Alt 是「改语义」的常规修饰键（Figma 里 Alt 也有「选中父级」的含义），点击与滚轮用同一修饰键，心智一致。
- 理由 3：Ctrl/Cmd+滚轮在浏览器里是页面缩放，不能占用；Shift+滚轮常被映射为横向滚动，同样不合适。

## 行为

| 操作 | 行为 |
| --- | --- |
| `Alt` + 点击 | 选中命中节点的**上一层**（已在顶层则选自己），并正常生成标记 |
| `Alt` + 滚轮↑ | 选中上一层（纯导航，不生成标记） |
| `Alt` + 滚轮↓ | 选中**第一个**带 `data-node-id` 的子元素（纯导航） |
| 无选中时 `Alt` + 滚轮 | 先选中光标下的最深节点，再等待下一次切换 |
| 普通滚轮 | 仍是缩放（不变） |

「点击 = 生成标记」「导航 = 不生成标记」的分工沿用既有语义：标记是给 AI 指代用的，面包屑/层级切换只是浏览。

## 变更清单

| 文件 | 内容 |
| --- | --- |
| `ui/src/frame-viewport.ts` | `BindOptions.onLevelStep(direction, point)`；`onWheel` 先判 `altKey`，命中则交回调并 `preventDefault`，不再缩放 |
| `ui/src/App.tsx` | `parentNodeElement` / `firstChildNodeElement` 两个助手；`onFrameClick` 支持 Alt；`stepLevel()` 处理方向、无选中时的兜底；面包屑抽取为 `chainOf()`，`focusNodeById` 复用 |

## 过程中修正

- **面包屑与选中不同步（既有缺陷）**：`focusNodeById`（点击标记、画板切换、现在的层级切换都走它）只更新选中高亮，不更新面包屑，导致「选中了 Star，面包屑还停在 App / Title」。现在 `chainOf()` 成为唯一来源，`selectNode` 与 `focusNodeById` 共用。

## 证据（2026-11-11，headless Chromium，fixtures/basic.pen）

```text
1) 点击 title              → selected: title,  crumbs: ["App","Title"]
2) Alt+点击 title          → selected: rootF,  crumbs: ["App"]
3) 顶层再 Alt+点击         → selected: rootF（不越界）
4) Alt+滚轮↓               → selected: title,  z: 1.190 → 1.190（未缩放）
5) Alt+滚轮↑               → selected: rootF
6) 普通滚轮                → z: 1.190 → 1.866,   selection 不变
7) 无选中时 Alt+滚轮↓      → selected: title,  crumbs: ["App","Title"]
8) 点 Star 后点标记 #1     → crumbs: ["App","Star"] → ["App","Title"]（面包屑跟随）
控制台错误                 → 0
```

自动化：`pnpm test` 10 文件 137 用例全绿，`tsc` 双端 0 错误，`pnpm build` 通过（ui 28.78 kB）。

## 未做

- 多步螺旋（Alt+滚轮连续多级）未做节流，快速连续滚动会逐级排队动画；实际使用未观察到问题。
- 层级切换不改变缩放倍率（只平移居中），这是有意为之：换层级通常是「看清当前这块」，不是「重新取景」。
