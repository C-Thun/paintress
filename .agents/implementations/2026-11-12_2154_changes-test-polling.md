# 2026-11-12T21:54+08:00 — 变更通知测试改轮询断言，消掉固定等待的 flake

`test/changes.spec.ts` 里两处 400ms 固定等待（等 daemon 非阻塞变更通知）改为轮询断言：

- 新增 `until(probe, timeoutMs=4000)`：每 30ms 探一次，条件成立即返回，超时抛明确错误。
- 新增 `readChanges(path)` 收敛 HTTP 轮询逻辑，两处用例共用。
- 触发条件早已命中：2026-11-12 全量跑两次出现过 `batch 插入的新节点 id 也会被记录` 偶发失败。

验证：`pnpm vitest run test/changes.spec.ts` 8/8 通过；后续两轮全量跑（15 文件 226 用例）均绿。
