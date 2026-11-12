# 2026-11-12T21:19+08:00 — FUTURE 盘点：三层优先级 + 附注 md 定为只读

对 `.agents/memory/FUTURE.md` 的全部活跃条目做了一次盘点，落地两处改动。

## 1. 顶部新增「优先级分层（2026-11-12 盘点）」

三层层一按推荐顺序排列，条目正文仍留在各自小节，表格只做指路与排序（不做第二份事实）。

- **层一（下一批就做）**：① 变更通知测试改轮询断言（~10 分钟，触发条件已命中两次）；② 变更高亮柔化（~30 分钟，一处 CSS）；③ 项目解绑线 #1+#2（~1 天，真 bug，operator 已被坑过）；④ web 关闭进程入口（~2 小时）；⑤ 画板级截图 `--board`（~2 小时，渲染层已输出 `data-board-x/y/w/h`）；⑥ 版本升级提示（~半天，发版前必需）。
- **层二（先定一两件小事）**：附注 md 只读视图、浏览器端交互回归、trusted publishing 迁移（硬期限 2027-01）、查看器只读属性面板/多稿切换、MCP Registry `server.json`。
- **层三（等触发或不划算）**：画谱 Album、渲染器未实现规格项、VS Code JSONC / Windows `.cmd` / Codex 陈旧路径、Vitest→`node:test`、`dts` 修复。

判定依据：读代码核实了可行性，不是凭印象估——
`src/render/html.ts` 的 `boardAttrs` 已输出 board 包围盒（截图选板无需新算几何）；
`src/web/registry.ts` 的 `ProjectEntry` 只有 agents/browsers，没有 owner 字段（自动解绑要补的正是这一层）；
`src/web/autoregister.ts` 的 `watch` 请求不带来源标记，与 CLI 手动 watch 无法区分（E1 的入口改动）；
`ui/src/App.tsx:220-221` 是待柔化的那两行 CSS；`src/web/daemon.ts` 已有 `/api/projects`，缺的是 `DELETE` 与 `/api/shutdown`。
仓库内无任何 `*.ptr` 与 `*.md` 同名组合（`demo/hello.ptr` 没有 `hello.md`），故 md 只读视图的触发条件仍未命中。

## 2. 附注 md 条目：范围砍掉写入

记下 operator 2026-11-12 原话：「那个 markdown，我想了下不需要做编辑，只要查看就行了，编辑等以后有了需要再说，因为编辑是个大坑，也有足够多的其他工具，何况大多数情况下是 AI 写给自己看的。」

由此删除的未决项：编辑器选型、编辑后落盘走 daemon 还是提示用户自己改。保留的未决：面板位置、md→HTML 方案（引库还是自写子集）、无同名 md 时不显示入口、md 内 `#短号` 跳转（留第二版）。

未跑测试：纯 `FUTURE.md` 文档改动，不涉及代码。
