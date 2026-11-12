# 新增 Windsurf / OpenCode 客户端 + 未列名客户端的通用接入指引（2026-11-12，0.3.0）

## 需求

`paintress install` 原本只覆盖 5 家（claude / cursor / vscode / codex / pi）。补上 Windsurf 和 OpenCode，并在 README 里写清「当前 agent 不在列表时怎么办」，让读文档的 AI 能自己接上。

## 为什么 OpenCode 不能只加一行

同一天存在两套布局：

| 布局 | 位置 | 条目 |
| --- | --- | --- |
| V2（当前官方文档） | `mcp.servers.<name>` | `{ type: "local", command: [cmd, ...args] }` |
| 旧版（本机实际在跑） | `mcp.<name>` | `{ command: [...], enabled: true, type: "local" }` |

写错布局不会报错，只是 opencode 读不到——静默失效。因此 `install` 必须按**已有文件**判断布局。

## 改动

| 文件 | 内容 |
| --- | --- |
| `src/integrations/clients.ts` | `ClientSpec` 去 `rootKey`/`needsType`，改 `rootPath: string[]`、`typeValue`、`commandForm`（`command+args` / `command-array`）、`extraFields`；新增 `windsurf`、`opencode` 两条 spec；`resolveRootPath()` 探测 OpenCode 布局；`buildEntry()` 支持数组命令与布局相关的 `enabled` |
| `src/integrations/install.ts` | `readTable`/`writeTable` 按路径读写 server 表（沿途补建、兄弟键与 `mcp.timeout` 之类元数据原样保留）；`planJsonMerge` 增加 `opencodeLayout` 选项 |
| `src/cli.ts` | 新增 `--opencode-layout auto\|legacy\|v2`（非法值直接报错） |
| `test/integrations.spec.ts` | +7 用例：Windsurf 路径/条目、OpenCode 路径（含 `XDG_CONFIG_HOME`）、新文件 V2、旧布局跟随且写 `enabled: true`、V2 里 `timeout` 不丢、强制布局 + 二次幂等、`mcp-config` 片段 |
| `README.md` / `README.zh-CN.md` | 客户端表补两行；客户端 id 列表更新并说明 OpenCode 双布局；原「打印片段」扩成「不在列表里怎么接」三步 + 如何把它变成内置支持 |

## 验证

- `test/integrations.spec.ts` 36 用例通过；全仓 **177 用例全绿**（11 文件）。
- 对本机真实的 `~/.config/opencode/opencode.json` 做纯函数合并（未落盘）：跟随旧布局，`mcp.paintress` 写入 `{type:"local", command:["paintress","mcp"], enabled:true}`，既有 `mcp.pencil` 保留；`--opencode-layout v2` 时改走 `mcp.servers` 且 `pencil` 仍在 `mcp` 下不动。
- `paintress mcp-config opencode` 输出 `mcp.servers` + 数组命令；`mcp-config windsurf` 输出 `mcpServers` + `command`/`args`。
- `pnpm build` + `paintress doctor` / `install opencode --dry-run` 正常。

## 已知边界

- OpenCode 新文件默认写 V2（官方当前文档）；旧版用户需 `--opencode-layout legacy`，README 已写明。
- Windsurf 已于 2026-06 更名 Devin Desktop，配置目录仍是 `~/.codeium/windsurf`，路径未变。
- Claude Code（项目级 `.mcp.json`，写入当前目录属行为变更）与 Zed（嵌套 `context_servers`）仍未内置，README 的通用指引覆盖它们。

## 追加：0.3.1 发版修复（同批）

首次发布 0.3.0 时 CI 打出一条被忽略的警告：

```text
npm warn publish "bin[paintress]" script name dist/cli.js was invalid and removed
```

npm 11 起 `bin` 值不允许 `./` 前缀：publish 时会被「自动纠正」（manifest 里存成 `dist/cli.js`，本地却写着 `./dist/cli.js`），并每次发版都告警。实测 0.3.0 装出来的 `bin` 仍可用（npm 是把值规范化而非真的删除），但本地与 registry 的清单不一致，属隐患。

- `package.json`：`"paintress": "./dist/cli.js"` → `"dist/cli.js"`。
- `scripts/verify-package.mjs`：`bin` 带 `./` 直接判失败，防止回归。
- 顺带补 `paintress --version` / `-v` / `version`（此前会落到「缺少 <file> 参数」，agent 探测版本时踩空）。
- README 双语安装手册的版本探测改为 `paintress --version`。
- 验证：178 用例全绿；`verify:pkg` 通过；三个版本入口都打印 `paintress 0.3.1`。
