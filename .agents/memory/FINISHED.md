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

### 当前质量基线（2026-11-11 更新）

- `tsc --noEmit`：root 与 ui 双端 0 错误
- `pnpm test`：10 文件 **137 用例全绿**
- `pnpm build`：daemon 56 kB + ui 28 kB
- 端到端实测：点击三节点得 `#1 #2 #3`、CLI 改节点后前端精确高亮、控制台零错误

### 阶段 6 — 画布交互（2026-11-11）

- 渲染器顶层节点输出 `data-board*`；视口控制器（滚轮锚点缩放 0.1–4 / 空格·中键·空白拖拽平移 / fit）落地在 iframe 内，只变换 `.ptr-canvas`。
- 画板条（≤1 画板时隐藏）+ 平滑聚焦；`Ctrl/Cmd+0` 100%、`Shift+1` fit；视口按「项目+文件」写 localStorage，刷新保持。
- 短号聚焦改为视口居中；拖拽超过 3px 吞掉后续点击，避免误选中。
- 顺带修复：刷新后 `?file=` 丢失（深链只剩 project）。
- 证据：`.agents/implementations/2026-11-11-stage6-canvas.md`（含浏览器实测数字）。

### 仓库迁移到 aliciai-dev（2026-11-11）

- GitHub Transfer 完成，旧地址 `C-Thun/paintress` 自动重定向；迁移时本地与远端均为 14 个 commit。
- 新 clone 重建通过：`pnpm install` / `build` / `test` 全绿（117 用例），基线不变。
- 顺带修复 pnpm 11+ 构建白名单字段失效（`allowBuilds` 取代 `onlyBuiltDependencies`）。
- 证据：`.agents/implementations/2026-11-11-repo-migration.md`、`2026-11-11-pnpm-allow-builds.md`。

### 阶段 4 剩余 — 嵌套层级切换（2026-11-11）

- `Alt`+点击选上一层；`Alt`+滚轮上/下一级（普通滚轮已是缩放，层级导航让给 Alt；裁决理由记录在实现记录里）。
- 顺带修复：焦点类选择（点标记 / 层级切换）面包屑不同步，`chainOf()` 成为唯一来源。
- 证据：`.agents/implementations/2026-11-11-stage4-nesting.md`。

### 阶段 5 前哨 — 发布打包与多客户端接入（2026-11-11）

- 发布产物修整：`exports["./mcp"]` 真实产出、`ui/dist` 入包、`prepack` 跑 `verify:pkg` 自检；tarball 51.4 kB / 11 files。
- 修掉 bin 经 npm 符号链接执行时静默退出（入口判定改 realpath 比对）。
- 新增 `paintress install` / `doctor` / `mcp-config`：五家客户端（Claude Desktop / Cursor / VS Code / Codex / pi）幂等写入，改动前备份，保留他人条目。
- dts 复测仍失败（`NodeSchema` TS7056），0.1.0 不发类型产物。
- 证据：`.agents/implementations/2026-11-11-stage5-publish-prep.md`。

### npm 首发（2026-11-11）

- `paintress@0.1.0` 与 `0.1.1` 已发布，**unscoped 根包名到手**（相似度过滤未拦截），`latest = 0.1.1`。
- 从 registry 安装验证：bin 可用、`ui/dist` 随包、MCP 握手正常、`install`/`doctor`/`mcp-config` 可用。
- 记录：`.agents/implementations/2026-11-11-publish-npm.md`（含 token 范围排障与 `0.0.0-stage` 占位说明）。

### 品牌与文档（2026-11-11）

- logo 矢量化：`assets/logo.svg`（两色 2 个 path，562×884，11.8 KB），与原图轮廓 IoU 92.8%。
- 查看器应用品牌两色（主蓝 `#254E8A`、1964 金 `#97885F`），侧栏嵌入 logo。
- 双语 README（英文主文件 + 中文互链），文末附「给 AI 的安装手册」（先检测后安装、多 agent 幂等注册）。
- 随包 skill `skills/paintress/SKILL.md`；CI 与 OIDC 发布工作流入仓。
- 证据：`.agents/implementations/2026-11-11-brand-docs-skill.md`。

### 发布 0.2.0 / 0.2.1（2026-11-12）

- `0.2.0`：install/doctor/mcp-config、随包 skill、双语 README、品牌图标与米白底界面、CI/发布工作流。
- `0.2.1`：版本号去硬编码（此前 MCP serverInfo、ping、`.ptr` generator 都写死 0.1.0）。
- 安装链路实测通过：全局安装 → `doctor` 解析出裸命令 → `install pi` 写入配置 → MCP 握手报 0.2.1。
- 证据：`.agents/implementations/2026-11-12-version-and-release-0.2.md`、`2026-11-12-icon-and-cream-ui.md`。

### 编码评审与修复（2026-11-12）

- 修复客户端检测、dry-run 布尔解析、配置权限保留、TOML 转义/重复表、超大画布缩放下限、Alt 横向滚轮，以及 OIDC 发布工作流的 npm CLI 与手动触发问题。
- 新增 9 个回归用例；最终 11 文件 170 用例全绿，真实 Chromium 验证通过。
- 记录与剩余风险：`.agents/implementations/2026-11-12-code-review-fixes.md`。

### 客户端覆盖扩到 7 家（2026-11-12，0.3.0）

- 新增 `windsurf`（`~/.codeium/windsurf/mcp_config.json`）与 `opencode`（`~/.config/opencode/opencode.json`）。
- OpenCode 双布局（`mcp.servers` 版本 / `mcp` 旧版）按已有文件探测，`--opencode-layout` 可强制；条目模型从 `rootKey`+`needsType` 泛化为 `rootPath` + `typeValue`/`commandForm`/`extraFields`。
- 双语 README 补「不在列表里怎么接」三步（定位配置 → 对照形状 → 打印片段）与「加一条 spec 即可内置」。
- `0.3.1` 修掉 npm 11 的 `bin` 前缀陷阱（`./dist/cli.js` 会被规范化并每次发版告警）并补 `paintress --version`。
- 证据：`.agents/implementations/2026-11-12-windsurf-opencode.md`（178 用例全绿 + 真实 opencode 配置合并实测 + 从 registry 全新安装验证）。

### 首批六项（2026-11-12）

- 变更通知测试：捕获真实通知 Promise 后用 `until()` 轮询；按本次新生成的节点 id 断言，不再受 1.5s 合并窗口导致的数组长度变化影响。
- 变更高亮：**线宽保持 2px**（1px 会与设计本身的描边混淆，operator 2026-11-12 裁决），1.4s × 3 轮脉动改为 2s 无限透明度往返（100% ↔ 25%），并加 `prefers-reduced-motion` 关动画。
- 项目解绑线：`ProjectEntry` 增 `owner`（agent / manual）；agent 自动注册的项目在最后一条 attach 断开、且无浏览器 SSE 时宽限 45s 后退场；`DELETE /api/projects/:name` + 项目行悬停 ×；`POST /api/shutdown` + 侧栏「关闭服务器」。破坏性接口要求 `x-paintress: 1` 头（跨站请求会触发预检，daemon 不应答预检）。
- 画板级截图：`RenderResult` 增 `boards`（顶层包围盒）；`paintress_screenshot { board }` / `shot --board`，匹配 id → name → 模糊，多命中报歧义并列候选，不猜。
- 版本升级提示：`src/web/update-check.ts` 查 npm latest（成功缓存 6h / 失败 10min，后台刷新永不阻塞、失败静默；`updateCheck` 默认关、CLI 开启）；徽章变上下两层（下层锈红加粗），点击弹窗给可复制提示词 + GitHub。
- 新增 `ui/src/confirm.tsx`：`Modal`（壳）+ `Confirm`（危险动作），解绑与关停两处复用。
- 评审补强（2026-11-13）：移除高亮 `box-shadow` 的 `!important`（它会使透明度关键帧失效）；关停时结束 agent/socket 与 SSE 活跃连接并准确计数；新增轻量 `/api/version` 轮询让首次后台探测结果自动出现；`shot --board` 缺值改为明确报错。
- 新增 `ui/src/frame-style.ts` 作为 iframe 样式唯一来源，`test/viewer-style.spec.ts` 用真实 Chromium 约束透明度确实变化。
- 质量基线：`tsc` 双端 0 错误，**16 文件 228 用例连续两轮全绿**，`pnpm build` 通过（dist 5 文件 148.6 kB、ui 42.3 kB）；查看器实测（Chromium / zh-CN）确认徽章自动出现、2 条长连接计数与关停后进程退出码 0。
- 证据：`.agents/implementations/2026-11-12_2*_*.md`（首批六条）与 `.agents/implementations/2026-11-13_*review-fixes*.md`（评审修正）。

### 0.5.0 发版排障与 --retag 恢复路径（2026-11-13）

- `v0.5.0` 首推 tag 时 publish 与 ci 同时失败，根因是**测试钩子的时间预算**而不是代码：`viewer-style.spec` 的 `beforeAll` 用 vitest 默认 10s `hookTimeout` 启动 chromium，而 CI runner 上的冷启动实测约 26s（同一次运行里 `shot.spec` 首用例耗时即为此）；钩子超时后 `afterAll` 又对 `undefined` 调 `close()`，把根因盖成 TypeError。
- 修法：该钩子抬到 60s 并判空；`shot.spec` 6 个用例的 30s 抬到 60s（首启占 26s，余量太薄）。
- 新增 `pnpm release --retag`：确认版本未上 registry → 跑同一套 gates → 把同名 tag 移到 HEAD 并 force push，用同一版本号重发；已发布版本拒绝移 tag。publish 失败时脚本直接打印这条恢复命令。
- 结果：tag 落在 `a5b38e8`，publish success（run 43282146161），`paintress@0.5.0` 在 registry 上且带 provenance attestation；本地 17 文件 233 用例全绿。
- 重复门禁与 CI 成本（publish 重跑同一 SHA 的测试、无 Playwright 缓存）已记入 `FUTURE.md#发布工作流的重复门禁与 runner 成本（2026-11-13）`。
- 证据：`.agents/implementations/2026-11-13_0242_release-retag-and-hook-timeout.md`。
