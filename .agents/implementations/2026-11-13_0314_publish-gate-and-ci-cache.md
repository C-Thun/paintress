# 2026-11-13T03:14+08:00 — 发布不再重跑测试（改为校验同一提交的 ci 结论），CI 缓存 Playwright

`v0.5.0` 发版时 publish 和 ci 同时红在同一个 chromium 钩子超时上。同一个 SHA、
同一套用例，在两条流水线上各跑一遍：失败概率翻倍、发版时间翻倍，且不产生任何新信号。
另外 ci 每次都要重下 ~150MB 的 Chromium。

## publish.yml

- **不再跑测试、不再安装 Chromium**。新增 `Require green ci for this commit`：
  用 `gh api` 轮询 `actions/workflows/ci.yml/runs?head_sha=<sha>`，
  等到 `completed`；`success` 才继续，其它结论直接失败并打印两条出路。
  tag 通常紧跟分支推送，所以轮询是必需的（上限 10 分钟）。
- 权限加 `actions: read`（读同一仓库的 ci 运行结论）。
- 逃生口 `skip_ci_check`（`workflow_dispatch` 输入）：仅在 ci 自身故障时使用，记录在 run 里。
- `workflow_dispatch` 下若该版本已在 registry 上则跳过发布（`::notice::`），
  用于**不改版本号验证整条流水线**；tag 推送不跳 —— 那种情况说明在重打已发布的版本，必须报错。
- 发布链路仍是 build → `verify:pkg` → `npm publish --provenance`，tag 与 package.json 版本一致性校验保留。

## ci.yml

- 加 `actions/cache@0057852…# v4`（v4.3.0）缓存 `~/.cache/ms-playwright`，
  key = `playwright-${runner.os}-${hashFiles('pnpm-lock.yaml')}`（playwright-core 版本在 lockfile 里）。
  命中时 `playwright install` 跳过下载，系统依赖照常补装。

## 校验

- 门禁脚本抽出来用桩 `gh` 跑 6 个场景：已绿 / 失败 / 取消 / 一直没运行后出现 /
  先 in_progress 后 success / API 抖动后恢复 —— 结论与退出码全部符合预期；`shellcheck --shell=bash` 干净。
- 发布步骤用桩 `npm` 跑 3 个场景：dispatch+已上架 → 跳过且不调用 publish；
  dispatch+未上架 → 调用 publish；tag 推送+已上架 → 不跳过。全部符合预期。
- 真实 Actions：ci 单 job 62s；`gh workflow run publish.yml` 复跑整条 publish run **29s 绿**，
  门禁日志 `ci success — <run>`，发布步骤 `paintress@0.5.0 已在 registry 上，跳过发布`。
  同一提交的旧版 publish run 是 71s。
- 缓存实测：首次 run 安装 22s（存缓存 6s），二次 run 命中 3s + 安装 13s。
