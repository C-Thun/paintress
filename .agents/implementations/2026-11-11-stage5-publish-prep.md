# 阶段 5 前哨：发布打包与多客户端接入（2026-11-11）

- 范围：把 `npm publish` 会真正发出去的东西修到可用，并补上「全局安装后各 agent 自动接入」的能力。
- 触发：`FUTURE.md#阶段 5` 的两个发布阻塞项 + operator 决策「带前端产物、全局安装、版本 0.1.0」。

## 变更清单

| 文件 | 内容 |
| --- | --- |
| `tsdown.config.ts` | entry 增加 `src/mcp/server.ts` → 产出 `dist/mcp/server.js`（`exports["./mcp"]` 此前指向不存在的文件） |
| `package.json` | `files` 增加 `ui/dist`；新增 `verify:pkg` 与 `prepack`（= build + 自检） |
| `scripts/verify-package.mjs`（新） | 发布自检：逐个校验 exports / bin / ui 产物 / shebang，缺失即退出 1 |
| `src/cli.ts` | 入口判定改 `realpath` 比对；新增 `mcp-config` / `install` / `doctor` 子命令 |
| `src/integrations/clients.ts`（新） | 五家客户端定义（路径、顶层键、是否需要 `type`）、启动命令解析、配置片段生成 |
| `src/integrations/install.ts`（新） | JSON 合并（保留他人条目）、TOML 只追加、备份 + 原子写 |
| `test/integrations.spec.ts`（新） | 24 个用例：路径解析、合并语义、启动命令回退、落盘与备份 |
| `README.md` | 安装、`install`/`doctor`/`mcp-config`、五家手工配置、查看器用法 |

## 修掉的三个真问题

1. **bin 装好之后静默退出**：`process.argv[1].endsWith('cli.js')` 在 npm 的 bin 符号链接下不成立（argv[1] 是 `node_modules/.bin/paintress`），主函数不执行、退出码 0、无输出。改用 `realpath(argv[1]) === realpath(import.meta.url)`。
2. **`exports["./mcp"]` 指向从不产出的文件**：`import 'paintress/mcp'` 必然失败。补 entry 后可在安装副本里 import 到 `createMcpServer` / `runStdioServer`。
3. **`files: ["dist"]` 漏掉 `ui/dist`**：daemon 按 `dist/../ui/dist` 定位前端，安装后 viewer 会退化成「前端未构建」。补上后 `/` 与 `/assets/*` 正常。

## 多客户端接入的设计取舍

- **只认已知客户端**（Claude Desktop / Cursor / VS Code / Codex / pi），不做全盘扫描；路径由 `home + platform + env` 计算，测试不依赖真实文件系统。
- **生成与写入分离**：`planJsonMerge` 是纯函数（输入现有文本 + 启动命令，输出目标文本与状态），`applyPlan` 才碰磁盘（备份 → 临时文件 → rename）。
- **只动自己那一条**：JSON 合并保留其他顶层键与他人 server；TOML 只追加，不重写既有内容。
- **启动命令的稳定性**：若 PATH 上的 `paintress` 指向当前脚本（全局安装的常态）就写裸命令，node 版本切换后配置不失效；否则回退绝对路径（本地/npx 场景）。
- **VS Code 的差异**：顶层键是 `servers` 且条目需要 `type: "stdio"`，已在 spec 里单独标注。

## 证据（2026-11-11）

```text
pnpm test             → 11 文件 161 用例全绿（新增 integrations 24）
pnpm check            → 0 错误
tarball               → paintress-0.1.0.tgz 51.4 kB / 11 files / unpacked 152 kB
临时 prefix 安装       → npm install 成功（100 包）
bin 执行              → 打印用法行（exit 0）
daemon                → GET / 返回 SPA；/assets/index-*.js → 200, 28784 B
库方式                → import('paintress/mcp') → ['createMcpServer','runStdioServer']
MCP 握手              → initialize → protocolVersion 2025-06-18, serverInfo paintress@0.1.0
渲染                  → 安装副本 render 三画板 fixture → 3 个 data-board
HOME 隔离下 install   → cursor 既有 {other, theme} 原样保留 + 备份；pi 新建
```

## dts 复测（未通过）

`dts: true` 直接构建失败：

```text
src/schema/nodes.ts(209,14): error TS7056: The inferred type of this node exceeds
the maximum length the compiler will serialize. An explicit type annotation is needed.
```

即 `PLAN.md#未决问题` 里的债仍在（此前记录为「已做」与事实不符）。

实验（同日）：给 `NodeSchema` 加显式注解

```ts
export const NodeSchema: z.ZodType<Record<string, unknown>, z.ZodTypeDef, unknown> = z.union([...]);
```

确实能通过 `pnpm check` 并产出 `.d.ts`，但 `dist/index-*.d.ts` 高达 **1548 KB**（整包 unpacked 从 164 KB 涨到 1.67 MB），因为其余导出 schema 的推断类型仍被完整序列化。结论：0.1.0 暂不发布类型产物；要发需要先给所有导出 schema 加显式注解瘦身，或改为按需导出 + api-extractor。实验已回滚（`dts: false`）。

## 未做

- 未发布到 npm（等包名决策与发版流程）。
- pi 的 `~/.pi/agent/mcp.json` 里的 `command` 用 `~/` 路径需要真会话验证（pi 文档声明支持 `command` 中的 `~/` 展开）。
