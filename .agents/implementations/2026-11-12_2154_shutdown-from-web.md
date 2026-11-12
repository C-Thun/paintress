# 2026-11-12T21:54+08:00 — 查看器可以关停 web 进程（带连接数与二次确认）

补上「用浏览器关掉 web 进程」的能力（FUTURE#项目解绑与进程关停 §3）。

- `POST /api/shutdown`：走已有 `shutdown('web 界面关闭')` 流程；**先 `res.once('finish')` 再退场**，避免响应被自己掐断；返回 `{ ok, shutdown, connections }`（连接数供确认文案使用）。
- 与 `DELETE /api/projects/:name` 共用 `isTrustedWrite()` 门槛（`x-paintress: 1`）。
- 查看器侧栏底部新增「关闭服务器」按钮 → `Confirm` 二次确认，文案列出将断开的连接数与 pid（`paintress web` 重启提示）。
- 关闭成功后前端盖一层「服务已关闭」说明（daemon 已走，页面不会再更新，不给个明确状态就像卡死）。
- i18n 中英双份文案：`closeServer` / `closeServerTitle` / `closeServerBody` / `serverClosed` / `serverClosedHint` / `cancel`。

验证：`test/autodetach.spec.ts` 覆盖「缺头 403 且进程仍在」「带头 200 后 socket 消失」；浏览器实测确认框渲染正常、无控制台错误。
