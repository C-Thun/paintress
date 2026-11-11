# 发布 paintress 到 npm（2026-11-11）

- 结论：**unscoped 根包名 `paintress` 拿到手了**。此前担心的相似度过滤（邻居 `paintless` 编辑距离 1、`painters` 距离 2）没有触发。
- 线上版本：`0.1.0`（首发）、`0.1.1`（帮助行修正），`dist-tags.latest = 0.1.1`，unpacked 163.7 kB / 11 files。

## 发布过程中确认的机制

### 1. 第一次 403 不是名字问题，是 token 范围

```text
403 You may not perform that action with these credentials.
403 Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

排查结果（`npm token list --json`）：

| token | bypass 2FA | 过期 | 范围 |
| --- | --- | --- | --- |
| `andares-2026-11`（当时在用） | true | 2027-02-03 | 只有 `@andares` |
| `wsl-2026-08`（两个月前发版用的） | true | 2026-11-05 **已过期** | All packages |
| `wsl-202611`（新建，用于本次） | true | 2027-02-09 | All packages |

即：旧的全包 token 到期后换成了只覆盖 `@andares` 的 token，所以 `@andares/*` 的版本更新一直正常，而**新的 unscoped 名不在范围内**被拒；npm 把它报成 2FA 要求，措辞有误导性。

### 2. 新包名发布有异步处理窗口

`npm publish` 返回 `PUT 202`，registry 随即出现占位版本：

```json
"0.0.0-stage": { "description": "Temporary package placeholder for staged publishing", "stub": true }
```

约 2 分钟后真实版本上线（`time.0.1.0 = 14:15:05Z`）。**这不是 staged publishing**：全程 `npm stage list` 为空、无待批条目；占位只是新包名处理期间的名字保留。

## 证据（发布后从 registry 验证，非本地）

```text
npm view paintress version            → 0.1.1
versions                              → ['0.0.0-stage', '0.1.0', '0.1.1']
npm install --prefix … paintress@0.1.1 → 安装成功
bin 执行                              → 用法行含 install|doctor|mcp-config（0.1.1 修正）
ui/dist 随包                          → assets/ + index.html 存在
MCP 握手（安装副本）                   → initialize → protocolVersion 2025-06-18, serverInfo paintress@0.1.0
mcp-config / doctor（安装副本）        → 正常输出
```

## 遗留与后续

- **bypass 2FA token 将在 2027-01 失去直接发布能力**（GitHub Changelog 2026-10-02），需要迁到 trusted publishing（OIDC）或 staged publishing + 2FA 批准。本次用的 token 建议在 CI 接好之后吊销。
- `0.0.0-stage` 占位版本会留在版本列表里（npm 机制产物），不影响 `latest` 安装。
- `dts` 仍未发布（见 `.agents/implementations/2026-11-11-stage5-publish-prep.md`）。
