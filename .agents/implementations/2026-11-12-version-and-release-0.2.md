# 版本号去硬编码 + 发布 0.2.0 / 0.2.1（2026-11-12）

## 修掉的问题

`0.2.0` 发出去后冒烟发现 MCP 握手仍报 `"version": "0.1.0"`——版本号在三处硬编码：

| 位置 | 影响 |
| --- | --- |
| `src/mcp/server.ts` `SERVER_VERSION` | MCP `initialize` 的 serverInfo 版本 |
| `src/web/daemon.ts` `VERSION` | `ping` / `status` 返回的版本 |
| `src/doc/io.ts` `GENERATOR` | 写进 `.ptr` 文件的 `generator: paintress/<version>` 元数据 |

新增 `src/shared/version.ts`：运行时从 `package.json` 读取（同时尝试 `../package.json` 与 `../../package.json`，覆盖 `dist/cli.js`、`dist/mcp/server.js`、源码三种布局），三处改为引用它。

## 发布

| 版本 | 内容 |
| --- | --- |
| `0.2.0` | install/doctor/mcp-config 子命令、随包 skill、双语 README、品牌图标、CI/发布工作流 |
| `0.2.1` | 版本号去硬编码（0.2.0 的 serverInfo 会报 0.1.0） |

`dist-tags.latest = 0.2.1`；包体 17 files / 236 KB unpacked。

## 安装链路实测（隔离 prefix，模拟 agent 在新会话里的行为）

```text
npm install -g --prefix /tmp/finaltest paintress@0.2.1   → 成功
paintress doctor                                          → launch: {command: "paintress", args: ["mcp"]}
paintress install pi                                      → 写入 ~/.pi/agent/mcp.json（create）
写入内容                                                  → {"mcpServers":{"paintress":{"command":"paintress","args":["mcp"]}}}
随包资源                                                  → assets/{logo.svg,icon-512*.webp}、skills/paintress/SKILL.md
MCP 握手                                                  → serverInfo {"name":"paintress","version":"0.2.1"}
```

要点：全局安装时 `doctor`/`install` 自动解析出**裸命令** `paintress`（PATH 上指向自身），因此配置在 node 版本切换、包升级后依然有效。

## 环境踩坑

ImageMagick `convert` 在本机 WebP 委托上挂死（8 分钟无输出、进程无响应）；位图转换改用 Pillow（`lossless=True`），512×512 秒级完成。
