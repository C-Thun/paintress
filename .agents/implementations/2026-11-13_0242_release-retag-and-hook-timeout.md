# 2026-11-13T02:42+08:00 — 修复发版测试钩子超时，新增 pnpm release --retag 恢复路径

`v0.5.0` 首推 tag 时 publish 与同一提交的 ci 同时失败，报错是
`Hook timed out in 10000ms` + `Cannot read properties of undefined (reading 'close')`。
同一份代码 20 秒前的 ci 是绿的，所以这不是回归，而是环境节奏问题。

## 根因

- `test/viewer-style.spec.ts` 的 `beforeAll` 里启动 chromium，用的是 vitest 默认
  `hookTimeout` = 10s。GitHub runner 上 chromium 首次启动是冷启动（下载解包后磁盘缓存为空），
  同一次运行里 `shot.spec` 的首个用例耗时 26s（几乎全是启动），10s 必然不够。
- 钩子超时后 `browser` 仍是 `undefined`，`afterAll` 直接 `browser.close()`，
  抛出的 TypeError 把真正的根因盖住，读日志时容易误判。

## 改动

- `test/viewer-style.spec.ts`：钩子超时抬到 60s（常量带注释说明 26s 实测），
  `afterAll` 改为 `await browser?.close()`，用例开头判空后给出明确错误。
- `test/shot.spec.ts`：6 个截图用例的 30s 预算抬到 60s —— 首启冷启动已占 26s，30s 只剩 4s 余量。
- `scripts/release.mjs`：新增 `--retag`。语义是**恢复**而不是发新版：
  确认当前 `package.json` 版本尚未上 registry → 分支/工作区检查 → 跑同一套 gates →
  把 `v<version>` 从旧提交移到 HEAD → force push 触发 CI 用同一版本号重发。
  已发布的版本会被拒绝移 tag；`--retag` 与版本位、`--local` 互斥。
  publish 失败时脚本直接打印这条恢复命令，不必现场想。
- `scripts/release.d.mts` + `test/release-args.spec.ts`：给 `parseArgs` 的参数契约加 5 条断言。

## 证据

- 本地：`pnpm check` 0 错误；`pnpm test` 17 文件 233 用例全绿。
- 远端：master `a5b38e8` 的 ci success；`pnpm release --retag` 把 tag 移到 `a5b38e8`
  （run 43282146161 success），`paintress@0.5.0` 已在 registry 上且带 provenance attestation。
