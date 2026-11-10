# 已完成

> 只放已收口的工作：摘要、证据指针、历史附录。
> 不在这里重述规格（给指针），也不留未完成项。

## 摘要

### 装框架与格式规格（2026-11-10）

- agent-framework v1 adoption：`AGENTS.md` 索引化、记忆契约落地、6 行覆盖表 0 OPEN。
- 格式规格 `format/spec.yaml` v0.2.0：pen_profile（冻结）/ ptr（演进）双层，17 处 enum_ref 交叉校验。
- 版权调研 `specs/pen-format-licensing.md`：结论「风险低」，三条红线（不复制文档原文 / 不触发竞争条款 / 商标）。
- 证据：`.agents/implementations/2026-11-10-stage1-core.md` 等。

### 阶段 1 — MCP 工具层 + CLI（2026-11-10）

- 9→12 个 MCP 工具；`paintress` CLI 19 个子命令。
- schema（Zod）、doc（原子写 + mtime 防覆盖）、ops（query/get/update/insert/delete/move/batch）。
- 证据：`.agents/implementations/2026-11-10-stage1-core.md`、`-stage1-mcp-cli.md`。

### 阶段 2 — 渲染器 + 截图（2026-11-10）

- `.pen` → HTML（每节点 `data-node-id`）、变量内联、ref 展开、样式/布局映射、Playwright 截图。
- 视觉验收通过（looker 代看 6 项判据全过）。
- 证据：`.agents/implementations/2026-11-10-stage2-render.md`。

### 阶段 3 — 统一 web 进程（2026-11-10）

- 单实例 daemon（lockfile）、UDS 控制面、HTTP 3316、SSE 热重载、按需 chokidar、idle 自动退出。
- 关键修正：连接存活替代 PID 轮询、UDS 优先、路径穿越双重校验。
- 证据：`.agents/implementations/2026-11-10-stage3-web.md`。

### 阶段 3.5 — Solid + Vite 前端（2026-11-10）

- `ui/` 子包：sidebar（项目/设计稿/标记）+ iframe 预览 + URL 状态同步 + SSE 热重载。
- daemon 改为 JSON API + 静态托管（`/api/*`、`/render/*`、`/files/*`、SPA 回退），保留无前端时的降级页。
- 版本：solid-js 1.9.18 + vite 8.3.7 + vite-plugin-solid 2.11.15（唯 4 个直接依赖）。
- 证据：`.agents/implementations/2026-11-10-ui-solid.md`。

### 阶段 4（部分）— 点击选中 + 会话短号 + 变更高亮（2026-11-10）

- 点击节点 → `#1 #2 #3` 短号 → `paintress_marks` 供 AI 读取映射 → 可用短号指代。
- 变更高亮：写工具 mark() → daemon ChangesStore（1.5s 合并 / 60s TTL）→ 前端琥珀色脉动。
- 期间修复：sandbox 缺 allow-scripts 导致回调被拦、hover 盖住选中框、`$` 前缀判断过宽、变更通知路径与最深根匹配。
- 剩余：嵌套层级切换（见 `FUTURE.md#阶段 4 剩余`）。
- 证据：`.agents/implementations/2026-11-10-stage4-marks.md`。

### 当前质量基线（2026-11-10 末）

- `tsc --noEmit`：root 与 ui 双端 0 错误
- `pnpm test`：9 文件 **117 用例全绿**
- `pnpm build`：daemon 55 kB + ui 22 kB
- 端到端实测：点击三节点得 `#1 #2 #3`、CLI 改节点后前端精确高亮、控制台零错误

### 仓库迁移到 aliciai-dev（2026-11-11）

- GitHub Transfer 完成，旧地址 `C-Thun/paintress` 自动重定向；本地与远端均为 14 个 commit。
- 新 clone 重建通过：`pnpm install` / `build` / `test` 全绿（117 用例），基线不变。
- 顺带修复 pnpm 11+ 构建白名单字段失效（`allowBuilds` 取代 `onlyBuiltDependencies`）。
- 证据：`.agents/implementations/2026-11-11-repo-migration.md`、`2026-11-11-pnpm-allow-builds.md`。
