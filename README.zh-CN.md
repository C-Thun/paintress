<div align="center">
  <img src="assets/icon-512-wordmark.webp" width="200" alt="paintress">
  <p>面向 AI agent 的设计稿操作层</p>
  <p><a href="README.md">English</a></p>
</div>

**安装方式：把本仓库地址贴给您的 agent，让它装 paintress。** 需要精确流程的 agent 见[文末的安装手册](#给-ai-agent-的安装手册)。

## 这是什么

paintress 读写结构化的设计稿——带公开 schema 的 JSON 文件（`.pen`，以及它自己写出的 `.ptr`）。它把设计稿渲染成 HTML，起一个本地查看器，并把同一套操作同时暴露为 MCP 工具和 CLI。

它不是编辑器：没有画布、没有拖拽、没有属性面板。人在浏览器里看设计稿并点击节点指认目标，agent 负责读写。

| 组成 | 作用 |
| --- | --- |
| MCP 工具 | 查询、读取、更新、插入、删除、移动、批量、校验、渲染、截图 |
| CLI | 同样的操作，外加查看器进程；不接 agent 也能用 |
| 查看器 | 本地 web 服务：渲染设计稿、高亮变更、把点击的节点变成 `#1`、`#2`… |
| 截图 | 整张画布的 PNG，给能看图的 agent 用 |

## 环境要求

Node.js 22 及以上。

## 安装

```bash
npm install -g paintress
```

然后把 MCP 条目写进您使用的客户端：

```bash
paintress doctor            # 查看已装情况、哪些客户端已有条目
paintress install           # 写入所有检测到的客户端配置
paintress install pi cursor # 或只写指定的客户端
```

`install` 只合并 `paintress` 一条，文件里其他内容保持原样，改动前写 `*.bak-<时间戳>` 备份；重复执行不会改变任何东西。

## CLI

```text
paintress mcp                                             启动 stdio MCP server
paintress info <file>                                     文档摘要
paintress query <file> [--type t] [--name n|--regex]   条件查询节点
paintress get <file> <id> [--depth n]                  读取节点子树
paintress update <file> <id> '<patch-json>'            浅合并更新属性
paintress insert <file> <parent> '<node-json>'         插入子节点
paintress delete <file> <id>                           删除节点
paintress move <file> <id> <parent> [--index n]        移动节点
paintress batch <file> '<ops-json>'                    一次执行多个操作
paintress validate <file>                              按格式规格校验
paintress render <file> <out.html>                     渲染为 HTML
paintress shot <file> <out.png> [--scale n]            渲染为 PNG

paintress web [--port n] [--idle ms] [--daemon]        启动查看器
paintress ping | status | stop                         查看器控制
paintress watch <name> <dir> | unwatch <name>          注册/移除要浏览的目录
paintress attach <name>                                agent 工作期间保持查看器存活

paintress install [client...] [--dry-run]              写入 MCP 配置条目
paintress doctor                                       查看各客户端配置状态
paintress mcp-config <client>                          打印单个客户端的配置片段
```

## 查看器

```bash
paintress web --daemon --idle 3600000
paintress watch demo ./demo
# 打开 http://localhost:3316/?project=demo&file=hello.ptr
```

画布操作：滚轮以指针为锚点缩放，空格 / 中键 / 空白处拖拽平移，`Ctrl/Cmd+0` 回到 100%，`Shift+1` 适应窗口。多画板文件会显示画板条。通过 CLI 或 MCP 做的修改会在查看器里高亮，点击会让节点获得短号，agent 用 `paintress_marks` 读回。

## MCP 客户端

`paintress install` 会写入下面这些位置，也可以手动添加。

| 客户端 | 配置文件 | 顶层键 |
| --- | --- | --- |
| Claude Desktop | `~/.config/Claude/claude_desktop_config.json` | `mcpServers` |
| Cursor | `~/.cursor/mcp.json` | `mcpServers` |
| VS Code | `~/.config/Code/User/mcp.json` | `servers`（条目需 `"type": "stdio"`） |
| Codex | `~/.codex/config.toml` | `[mcp_servers.paintress]` |
| pi | `~/.pi/agent/mcp.json` | `mcpServers` |

```bash
paintress mcp-config cursor   # 只打印片段，不改文件
```

## Skill

`skills/paintress/SKILL.md` 是给 agent 的简短说明：什么时候用这些工具、`#1` 怎么映射到节点 id、哪个工具做什么。支持 skill 机制的客户端把它复制进对应目录即可。

## 文档

- `specs/PLAN.md` —— 路线与未决问题
- `format/spec.yaml` —— 文件格式规格（`.pen` 层冻结，`.ptr` 层演进）
- `.agents/memory/ARCHITECTURE.md` —— 设计决策与理由
- `.agents/implementations/` —— 每次变更的记录与实测数据

## 许可

MIT

---

## 给 AI agent 的安装手册

您是被要求在本机安装 paintress 的 agent。请按顺序执行，并汇报：发现了什么、复用了什么、改动了什么。

**先检测。** 一台机器上可能有多个 agent，之前的 agent 可能已经全局安装过 paintress 并给自己注册过。再装一份是错误，不是周全。

### 0. 检测

| 检查项 | 命令 | 含义 |
| --- | --- | --- |
| PATH 上是否已有 | `command -v paintress` | 已有可用安装 |
| 是否全局安装 | `npm ls -g --depth=0 paintress` | 通过 npm 装在全局 |
| 是否项目内安装 | `npm ls --depth=0 paintress` | 装在当前项目里 |
| 客户端配置 | `paintress doctor` | 哪些 agent 已有条目、状态如何 |

规则：

- **命中任意一项就复用**，不要重装，直接进入第 2 步。
- 向用户报告解析到的路径与版本（查看器运行时 `paintress ping` 会打印版本；包版本用 `npm ls -g --depth=0 paintress`）。
- 只有在全部检查都为空时，才执行第 1 步。

### 1. 安装（仅在检测全空时）

```bash
npm install -g paintress
```

如果环境不允许全局安装：

```bash
npm install paintress          # 项目内安装，之后用 npx paintress ...
npx -y paintress@latest ...    # 完全不安装，首次运行较慢
```

优先全局安装：只有全局安装，下一个 agent 才能直接复用。

### 2. 给「当前所在的 agent」注册 MCP

```bash
paintress doctor                    # 列出检测到的客户端与状态
paintress install --dry-run         # 预览将要写入的内容
paintress install <client-id>       # 只写当前所在的客户端
```

客户端 id：`claude`、`cursor`、`vscode`、`codex`、`pi`。不带参数执行 `paintress install` 会覆盖所有检测到的客户端。

写入行为：

- 新增或更新名为 `paintress` 的一条（`mcpServers.paintress`；VS Code 为 `servers.paintress`；Codex 为 `[mcp_servers.paintress]`）；
- 文件里其他键、其他 server、既有排版一律不动；
- 替换前在同目录写 `*.bak-<时间戳>` 备份；
- 幂等：条目已一致时返回 `noop`，不写磁盘；
- 当 `paintress` 能在 PATH 上解析时写裸命令，否则写可执行文件的绝对路径。

如果当前 agent 不在列表里，打印最接近的片段再自行适配：

```bash
paintress mcp-config cursor   # JSON，顶层 mcpServers
paintress mcp-config vscode   # JSON，顶层 servers + type: stdio
paintress mcp-config codex    # TOML 表
```

### 3. 安装 skill（建议）

```bash
mkdir -p <技能目录>/paintress
cp "$(npm root -g)/paintress/skills/paintress/SKILL.md" <技能目录>/paintress/SKILL.md
```

使用您的 harness 真正读取的技能目录（`~/.pi/agent/skills/`、`~/.claude/skills/`、`.cursor/skills/` 等）。如果 harness 没有 skill 机制，把该文件读入上下文一次，并记住工具清单。

### 4. 验证

```bash
paintress doctor                                        # 条目存在、命令可解析
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}\n' | paintress mcp
```

第二条命令应当返回包含 `"serverInfo": {"name": "paintress", …}` 的 `result`。会话重启后，对任意 `.pen` 文件调用 `paintress_doc_info` 是一次端到端验证。

### 5. 多 agent 规则

- 一份全局安装服务本机所有 agent，不要为每个 agent 复制一份。
- 每个 agent 只添加**自己**的配置条目；不要重写其他 agent 的文件，也不要删除不是自己添加的条目。
- 如果 `doctor` 显示 `noop`，说明已有人正确注册过——就此停下并说明情况。
- 汇报格式：复用 / 新装 / 注册（哪个客户端）/ 跳过（原因）。

### 6. 卸载

```bash
npm uninstall -g paintress
```

然后从各客户端配置里删掉 `paintress` 条目，或恢复同目录下最新的 `*.bak-<时间戳>`。
