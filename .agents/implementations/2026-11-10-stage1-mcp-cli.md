# 阶段 1 完成：MCP 工具层 + CLI（2026-11-10）

- 范围：`specs/technical-plan.md` 阶段 1 收尾（承接 `2026-11-10-stage1-core.md`）。
- 依赖：`@modelcontextprotocol/sdk` 1.32.2（zod peer ^3.25，与现有 zod ^3 兼容）。

## 变更清单

| 文件 | 内容 |
| --- | --- |
| `src/mcp/tools.ts` | 9 个共享 handler（MCP 与 CLI 同一套）：doc_info / query / get / update / insert / delete / move / batch / validate。读=load→返回；写=load→操作→校验（结构错误不落盘）→原子保存（mtime 防覆盖、保持原风味） |
| `src/mcp/server.ts` | `createMcpServer()`（registerTool 包装，异常→isError 文本）+ `runStdioServer()` |
| `src/cli.ts` | `paintress` bin：mcp / info / query / get / update / insert / delete / move / batch / validate 子命令；`parseArgv` 纯函数 + `main(argv)` 可测入口；零额外依赖 |
| `test/mcp.spec.ts` | InMemoryTransport 全链路：工具发现、读写、错误传播（8 用例） |
| `test/cli.spec.ts` | parseArgv 单测 + main 冒烟（8 用例） |
| `package.json` / `tsdown.config.ts` | bin 入口、`./mcp` 子路径导出、双 entry 构建 |

## 设计要点

- **工具名 `paintress_*`**（偏离 technical-plan 的 `ptr_*` 简写，与产品名一致；已在此记录偏离）。
- **无状态工具**：每次调用独立 load→save，靠写入时的 mtime 防覆盖兜底并发；不引入会话状态。
- **pen 风味保真**：写 `.pen` 不注入 x-paintress（转换成 `.ptr` 是显式操作，未来单独做）。

## 过程中修正

1. **batch 落盘丢失（真 bug，集成测试抓住）**：`batch()` 是克隆语义返回新文档，而 `write()` helper 保存的是被就地修改的原文档——变更被丢弃。修正：四类 op 只改 children 树，`doc.children = out.children` 回填后走统一写路径。
2. interface→type 别名两处（GetResult / ValidationResult）：TS interface 无隐式索引签名，无法赋给工具输出类型。

## 证据

- `pnpm exec tsc --noEmit`：0 错误
- `pnpm test`：5 文件 54 用例全过（2026-11-10）
- `pnpm build`：3 文件 40.78 kB；dist/cli.js 保留 shebang
- stdio 冒烟：initialize → `paintress 0.1.0`；tools/list → 9 工具
- CLI 冒烟：info / update+get 落盘复读一致 / 错误路径 exit=1
