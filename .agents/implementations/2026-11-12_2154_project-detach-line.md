# 2026-11-12T21:54+08:00 — 项目解绑线：agent 退出自动退场 + 查看器手动解绑

修掉 FUTURE 里记的真 bug（「退 agent 后 watch 项目一直挂着」）并补上手动解绑入口。

## 服务端

- `src/web/registry.ts`：`ProjectEntry` 新增 `owner: 'agent' | 'manual'`。手动 watch 永远覆盖自动标记，反向不成立（人绑的只能人解）。
- `src/web/protocol.ts`：`watch` 请求增可选 `owner`；`src/web/autoregister.ts` 自动注册时带 `owner: 'agent'`。
- `src/web/daemon.ts`：
  - `detachProject()` 收口「移除项目 + 释放同根目录的监听 + 推注册表事件」，socket `unwatch` 与 HTTP 解绑共用。
  - `maybeScheduleAutoDetach()`：仅当 `owner === 'agent'` 且 `registry.isIdle()`（无 agent、无浏览器）时起宽限定时器（`autoDetachMs`，默认 45s，跨过 agent 崩溃重启窗口）；期间 attach 到达、浏览器 SSE 打开、或被手动 watch 接管都会撤销。
  - 挂点：attach 连接关闭、SSE `close`、`watch`（撤销）、`unwatch`、daemon shutdown（清全部定时器）。
  - `DELETE /api/projects/:name`：幂等，不存在返回 `unwatched: false`。
  - 破坏性接口要求 `x-paintress: 1` 头。不做 Origin 白名单：手机经隧道/反代访问时 Origin 是反代域名，白名单会误伤；自定义头已足够挡住跨站请求（会触发 CORS 预检，daemon 不应答）。

## 查看器

- 项目行改为 `li.row`：主按钮 + 悬停出现的 `×`（触屏常驻，`@media (hover: none)`）；点击弹二次确认（说明「文件不受影响、agent 下次启动会重新注册」）。
- 新增 `ui/src/confirm.tsx`：`Modal`（壳：遮罩、Esc/点遮罩关闭、初始焦点）+ `Confirm`（危险动作按钮组）。

## 验证

- `test/autodetach.spec.ts`（新，9 用例）：宽限期内仍在 → 超时后解绑；宽限期内重新 attach 撤销；浏览器 SSE 打开时不退场、关掉后退场；手动 watch 不退场；DELETE 缺头 403 / 带头解绑 / 重复调用幂等；未开 updateCheck 时 `latest` 为 null。
- 全量 `pnpm vitest run`：15 文件 226 用例全绿；`tsc` 双端 0 错误。
- 浏览器实测（Chromium / zh-CN，port 3399）：无控制台错误，`×` 悬停出现、确认框正常。
