# Paintress

面向 AI agent 的设计稿操作层。用 MCP 工具读写结构化的 `.pen` 设计稿，渲染为 HTML，在浏览器里查看与标记。

早期开发中，尚未发布。

## 能力

- **读写**：查询、修改、插入、删除设计稿节点，保持文件格式不变
- **渲染**：设计稿 → HTML/CSS，由浏览器排版，输出可直接使用的页面
- **查看**：本地服务，文件变更自动刷新
- **标记**：点击节点生成短号，便于在对话中指代

## 安装

要求 Node.js ≥ 22。

```bash
npm install -g paintress     # 全局安装，命令名为 paintress
npx paintress --help         # 或临时运行
```

## 接入 MCP 客户端

服务端就是一条 stdio 命令：`paintress mcp`。各客户端的差异只在配置文件位置与顶层字段名。

### 自动写入（推荐）

```bash
paintress doctor                 # 先看各客户端是否已安装、配置是否已就位
paintress install --dry-run      # 预览将要写入的内容，不动磁盘
paintress install                # 写入所有已检测到的客户端
paintress install pi cursor      # 只写指定客户端
```

写入规则：只合并 `mcpServers.paintress`（VS Code 为 `servers.paintress`）这一条，其他键与他人条目原样保留；改动前会生成 `*.bak-<时间戳>` 备份；已有的 Codex TOML 只追加不重写。

单个客户端也可以只要片段：

```bash
paintress mcp-config pi          # 输出 JSON 片段
paintress mcp-config codex       # 输出 TOML 片段
```

下面是手工配置时的完整写法。

### Claude Desktop

`claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "paintress": { "command": "npx", "args": ["-y", "paintress", "mcp"] }
  }
}
```

### Cursor

`~/.cursor/mcp.json`（全局）或 `.cursor/mcp.json`（项目，可提交）：

```json
{
  "mcpServers": {
    "paintress": { "command": "npx", "args": ["-y", "paintress", "mcp"] }
  }
}
```

### VS Code

`.vscode/mcp.json`（顶层键是 `servers`，不是 `mcpServers`）：

```json
{
  "servers": {
    "paintress": { "type": "stdio", "command": "npx", "args": ["-y", "paintress", "mcp"] }
  }
}
```

### Codex

`~/.codex/config.toml`：

```toml
[mcp_servers.paintress]
command = "npx"
args = ["-y", "paintress", "mcp"]
```

### pi

`~/.pi/agent/mcp.json`（用户级）或 `.pi/mcp.json`（项目级）：

```json
{
  "mcpServers": {
    "paintress": { "command": "paintress", "args": ["mcp"] }
  }
}
```

若 paintress 装在 `~/.pi/agent/npm` 里（该目录的 `.bin` 不在 PATH），`command` 写成 `~/.pi/agent/npm/node_modules/.bin/paintress`。

## 查看设计稿

```bash
paintress web --idle 3600000   # 起本地查看器（默认 http://localhost:3316）
paintress watch demo ./demo    # 注册一个项目目录
```

浏览器打开 `http://localhost:3316/?project=demo&file=hello.ptr`：滚轮以光标为锚点缩放，空格 / 中键 / 空白处拖拽平移，`Ctrl/Cmd+0` 回 100%，`Shift+1` 适应窗口；多画板文件会显示画板条。

## 原则

- 只处理明文 JSON 设计稿，不依赖任何商业设计工具的 SDK、账号或托管服务
- 渲染输出标准 HTML，不使用私有格式
- 不含编辑器 UI：支持查看与标记，不支持拖拽改布局
- 写入前备份、原子替换，避免数据损坏

## 许可

MIT
