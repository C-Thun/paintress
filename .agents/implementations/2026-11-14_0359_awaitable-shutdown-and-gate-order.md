# 2026-11-14T03:59+08:00 — Make daemon shutdown awaitable and run release gates build-before-test

`pnpm release --retag`（v0.6.0）在本地 gates 的 `pnpm test` 挂掉，`test/web.spec.ts` 11 条失败：

1. `idle 自动退出`：700ms 后 socket 仍在（`expected true to be false`）；
2. 后续每条 `startDaemon` 都报 `paintress web 已在运行（pid 670724）`；
3. 再往后全部 `ECONNREFUSED 127.0.0.1:37843`（`baseUrl` 指向已死端口）。

## 根因（daemon 真 bug）

```ts
async function shutdown(reason) { if (closing) return; closing = true; … }
```

第二个调用会**立刻 resolve**，而第一次关停还在关 socket / 释放锁。
web.spec 的生命周期用例正是这样：idle 关停已经在飞 → `daemon.close()` 提前返回 →
`startDaemon` 撞上还没释放的锁 → 之后所有用例用死端口。

## 改了什么

- `shutdown()` 保存进行中的 Promise 并对后续调用返回同一个：`close()` 的语义变成「已经关完」，
  不再是「有人在关」。
- `test/web.spec.ts`：生命周期用例改成轮询 socket 消失（上限 5s），不再假设 700ms 够用。
- 新增回归用例：并发两次 `close()` 都必须等同一个关停，关完立刻能起新 daemon。
- `scripts/release.mjs`：gates 顺序改成 **先构建再测试**（与 `ci.yml` 一致）。
  `web.spec` 的 SPA 回退用例和新的 `ui-interaction.spec` 都读 `ui/dist`，
  先测试在干净工作区上会静默 skip 或直接失败。

## 证据

- 本地复现不了原始抖动（6 轮全量 + 8 核负载 3 轮均绿），但上面的 `close()` 提前返回是**确定性**的，
  且能完整解释失败链。
- 干净工作区模拟（`rm -rf dist ui/dist`）后按 release 顺序跑：`check` → `ui typecheck` → `build` →
  `test` → `verify:pkg`，**22 文件 291 用例全绿**，`verify:pkg` 通过。
- 提交：`38f9859`。
