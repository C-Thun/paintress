# 2026-11-12T21:55+08:00 — 画板级截图：screenshot/shot 支持 --board（id 或名字）

`paintress_screenshot` / `paintress shot` 支持按画板导出 PNG。

- `src/render/html.ts`：新增 `BoardBox` 与 `boardBoxes()`（顶层节点包围盒，复用 `nodeBox` 的同一条规则）。
- `src/render/entry.ts`：`RenderResult` 增 `boards`（与 `canvas` 同源，不再另算几何）。
- `src/shot/screenshot.ts`：
  - `selectBoard()`：id 精确 → name 精确 → name/id 模糊（不区分大小写）；多命中**报歧义并列出候选**，不猜；空画布/空查询各给明确错误。
  - viewport 取 `max(canvas, 画板右/下边界)`，`clip` 用画板包围盒（Playwright 的 clip 是页面坐标）；画板尺寸为 0 时直接报错。
  - `ShotResult.board` 回传命中的画板（id/name/x/y/width/height）。
- `src/mcp/tools.ts` 与 `src/cli.ts` 暴露 `board` 参数；README 与随包 skill 同步（提醒 AI：多画板文档别截整张）。

验证：`test/shot.spec.ts` 12 用例（新增 6 条纯函数匹配规则 + 4 条真实 Chromium 截图），其中按 `detail` 截得 400×300、按中文名「首页」截得 800×600、2x 下 `ghost` 得 400×400、歧义名 `o` 报错且不产出文件。
