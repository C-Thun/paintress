# 设计稿笔记（同名 Markdown 抽屉）

## 需求

设计稿旁边可以放一份同名 `.md`（`home.ptr` → `home.md`），写这份设计的解析、待定项、对应需求。
**只读**（operator 2026-11-12 定）：paintress 不开写路径，agent 用普通文件工具写，人用编辑器改。

界面（operator 2026-11-13 定）：
- 当前选中文件有同名 md 时，画布矩形**左上角**出现 md 图标；没有就不出现。
- 点击后画布矩形**向右收窄**，左侧切入一个同样圆角的矩形区域显示 md；md 宽度固定，只有右侧画布随窗口变。
- md 内容右上角有关闭按钮；展开后左上角图标消失。
- 解析用第三方库，不自写。

## 方案

- 库：**marked**（49KB min / 14.9KB gzip，0 依赖），**只在抽屉打开时动态 import**（Vite 切独立 chunk，首屏体积不变）。
- 输出策略（`ui/src/markdown.ts`）：原样 HTML **转义成文本**（不执行），链接只放行 `http(s)` / `mailto` / `#`，外链加 `target=_blank rel=noreferrer`。理由：笔记与查看器同源，裸 `innerHTML` 可被 `onerror` 打到查看器自己的写接口。
- 接口：`GET /api/notes?project=<name>&path=<rel>` → `{ ok, exists, markdown?, path? }`；路径经 `safeJoin` 校验，只认「设计稿同目录、同名的 `.md`」，大小上限 512KB。
- 热更新：`/events?project&path` 除设计稿外**同时监听同名 md**；`watchers.acquire` 补 `add` 事件（md 从无到有也能推）。抽屉打开时收到事件即重取。
- 布局：`.stage` 里新增 `.canvas-row`（flex 行，gap 12）：`aside.panel.notes`（固定 380px）+ `.canvas-wrap`（flex 1，position relative，装 iframe 与浮动控件）。笔记抽屉**占布局**，浮动工具条/面板**覆盖**画布。

## 验收

1. 有 md：图标出现 → 点击后抽屉出现、画布宽度减少 380+gap、图标消失 → 点关闭：恢复。
2. 无 md：图标不出现，抽屉不可打开。
3. 打开抽屉时用编辑器改 md：不刷新页面，内容自动更新。
4. `../` 穿越、超长文件、非同名 md：接口拒绝且不泄露路径。
5. 首屏 JS 体积不因 marked 变大（构建产物里有独立 chunk）。
