# 2026-11-13T21:38+08:00 — Ensure the viewer idempotently, and require it before the first edit

agent 开始作画时，查看器往往根本没起（daemon 空闲退出、`paintress stop`、或启动竞争失败），
而旧的 `paintress web` 在已有实例时直接报「已在运行」、`--daemon` 又会无条件再 spawn 一个子进程
（输掉竞争的子进程静默退出，调用方只看到 6s 超时）。所以「先确保 web 在跑」这条指令没法让 agent 无条件执行。

## 改了什么

**幂等（命令本身）**
- `ping` 响应加 `port`：调用方不需要猜默认端口。
- `client.queryDaemon()`：唯一的「在不在跑」判据；残留 socket / 无响应一律当未运行。
- `spawn.ensureDaemon()`：已在跑 → 直接复用（`started:false`，pid/端口取自 daemon 自己）；
  并发启动时输掉竞争的一方复用赢家；子进程早退时报退出码 + 锁持有者诊断，而不是干等超时。
- `cli web`：前台形式也复用（打印 pid/端口/URL 后退出 0），`--daemon` 走 `ensureDaemon`；
  显式 `--port` 与运行中端口不一致时仍然报错（幂等不等于悄悄丢参数）。
- `startDaemon` 的锁错误文案修正：`paintress web --stop` → `paintress stop`。

**指令（作画前）**
- MCP server 在 initialize 里下发 `instructions`：查看器优先 + 工作流 + 明确声明幂等。
- 新工具 `paintress_viewer`（第 14 个）：确保 daemon、注册项目、返回可打开的 URL。
- MCP server 在每个写工具（new/update/insert/delete/move/batch）前 best-effort 再 ensure 一次；
  该行为只在 stdio 入口开启（`createMcpServer({ ensureViewerBeforeWrite: true })`），
  测试与嵌入场景不会因此拉起后台进程。
- `autoregister.ts` 抽出 `ensureViewer()`：daemon/项目/attach 三层都幂等，attach 句柄按项目持有，
  只有真拉起 daemon 的那次才开浏览器。启动时注册与「画前补一次」走同一条路径。
- `SKILL.md` 新增「Start the viewer before you draw」并把「Viewer first」列为工作规则第 1 条；
  README / README.zh-CN 同步。

## 证据

- `pnpm check`（server）0 错误；`pnpm --dir ui typecheck` 0 错误；`pnpm test` **18 文件 257 用例全绿**
  （新增 `test/viewer-ensure.spec.ts` 9 例）；`pnpm build` 通过。
- 端到端（隔离 `PAINTRESS_HOME` + 端口 34569，`PAINTRESS_NO_OPEN=1`）：
  连续三次 `web`（`--daemon` / `--daemon` / 前台）输出同一个 pid，`ps` 里只有一条
  `cli.js web --port 34569`；`paintress stop` 后 `ping` 返回 `running:false`、进程清零。
- 提交：`0f4dc7f`。
