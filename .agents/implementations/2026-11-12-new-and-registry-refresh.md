# 2026-11-12 — paintress_new 创建能力 + 项目列表自动刷新 + 注入指令

## 需求（operator 原话）

1. 「检查提供给 AI 的 MCP/skill 等，有没有明确的创建文件用的 MCP 指令？pencil 不提供创建文件的指令（至少在 vscode 中不支持）让人很不爽，AI 应该能自由地创建需要的 ptr 文件」
2. 「这套系统中要明确标明 ptr 是 paintress 的标准文件格式，同时兼容 pen」
3. 「在注入的信息里明确提到将项目绑进 paintress 里去，以后不要用户说。目标是用户只要说看下什么设计，画什么东西，AI 能反应过来把项目绑 paintress 进程提供查看的能力」
4. 「我绑了多个项目进去的时候，原窗口没有自动刷新出来新的项目，我还是按 F5 才刷出来，这个问题要解决」

## 变更

### 1. `paintress_new`（MCP 工具 + CLI 子命令 `new`）

- 新增 `src/doc/create.ts`：`createDoc()` 生成「一个空 board」的最小可用文档，board 默认 900×600、白底、纵向 flex（免得调用方一开始就算 x/y），`version` 取自新常量 `PEN_DOC_VERSION`（与 `spec.yaml` 的 `observed_document_version` 一致）。
- `src/mcp/tools.ts` 新增 `paintress_new`：path 不带扩展名**自动补 `.ptr`**（标准格式默认）；已存在拒绝覆盖，`overwrite=true` 才写；连带创建父目录；落盘前过 `validateDoc`；返回 `{path, flavor, boardId, canvas}`。
- 显式写 `.pen` 扩展名时仍产出 pen（兼容旧工具链），但描述里明确 ptr 是标准。
- CLI：`paintress new <file> [--name --width --height --fill --layout --padding --gap --force]`。
- 测试 `test/mcp.spec.ts` 3 个用例：默认补 .ptr 且 x-paintress.spec=1 / 拒绝覆盖 + overwrite / 新建后立即可 insert。工具总数断言 12→13。

### 2. 「ptr 是标准格式」全面声明

| 文件 | 改动 |
| --- | --- |
| `README.md` / `README.zh-CN.md` | What is it 段落改为「`.ptr` is paintress's standard format / `.pen` is compatible」，CLI 表加 `new` |
| `format/README.md` | 双格式策略首条加粗声明 + 「新建一律产出 .ptr」 |
| `skills/paintress/SKILL.md` | 新增 **Formats** 段（ptr 默认创建、pen 兼容不转换）；description 里写明；工具表加 `paintress_new`；工作规则加「Nothing to edit? Create it.」与 `content` 字段名/`update` 不校验字段名的坑 |

### 3. 注入指令：agent 自己绑项目，不等用户说

`SKILL.md` 新增 **"Bind the project yourself — do not wait to be asked"** 段：

- 用户说「看设计/画东西」→ agent 自己确认项目已绑（MCP 启动时 `autoRegister` 已自动注册 cwd），直接给出查看器 URL / 深链 `?project=&file=`；
- 设计稿在别处 → agent 自己跑 `paintress watch <name> <dir>`，命名优先用自动推导名保持 URL 稳定；
- 明确「绝不要求用户去跑 watch」。

配套改动：`autoregister.ts` 把自动拉起 daemon 的 idle 从默认 60s 放宽到 1h —— 之前自动拉起的 daemon 会在 agent 空闲一分钟后整个退出，下一次交互又要冷启动，「自动绑定」体验不成立。

### 4. 项目列表自动刷新（不再需要 F5）

两层推送，`src/web/daemon.ts`：

1. **注册表 SSE 通道**：`GET /events`（不带 project 参数）返回 `text/event-stream`，加入 `registryClients` 集合；socket 控制面的 `watch`/`unwatch` 成功后 `notifyRegistry()` 推 `event: projects`。
2. **目录监听**：每个项目根 `fs.watch(recursive)` 监听设计稿增删（agent 新建文件、或人在编辑器里存了个新稿），150ms 合并去抖后同样推 `projects` 事件。unwatch 后目录无其它项目引用时关掉 watcher。shutdown 时统一清理（watcher、keepalive、SSE 连接）。

前端 `ui/src/App.tsx`：

- `onMount` 常驻一个 `EventSource('/events')`，`projects` 事件 → `refreshRegistry()`：重拉项目列表 + 当前项目的文件列表；
- 当前项目被 unwatch / 当前文件被删 → 清选中态并回写 URL；
- **当前项目没有选中文件、且来了新文件时自动选中第一个新文件**——配合 agent「new 一个文件→让人看」的动线，用户连点都不用点。
- `ui/src/api.ts` 加 `registryEventsUrl()`。

测试：`test/web.spec.ts` 新增「无 project 参数订阅后 watch 新项目会推 projects 事件」（fetch 流式读取 + 5s 截止，先订阅后注册，证明是推送不是重放）。

### 5. FUTURE.md 三条新计划

- **画板级截图导出**：`paintress_screenshot` 加 `board` 选择子（id/name，多命中报歧义），命名沿用代码里已有的 **board/画板**；CLI `--board`。等真实需求出现再动 shot 层。
- **附注设计稿笔记**：同名 `.md` 作为该设计的解析与标注，查看器里查看 + 轻改；先查看后编辑；未决关联方式/落盘路径/`#短号` 节点引用。
- **画谱手改入口**：token/preset 的数值、颜色在查看器里直接输入框改（走 MCP 同一条写路径）；画谱方案落地第一版后触发。

## 验证

- `pnpm check` 0 错误；`pnpm build` 通过；**185 测试全绿**（原 181 + new 3 + registry SSE 1）。
- 手测：`node dist/cli.js new /tmp/x/board --name Home --width 1440 --height 900` → info 正常 → shot 正常出 1440×900 PNG。

## 遗留

- 自动选中新文件的逻辑只覆盖「当前没选中文件」的场景；用户已选中 A 又来新文件 B 时不抢焦点（有意为之，避免打断查看）。
- 目录监听依赖 inotify（Linux recursive watch）；macOS 上 `fs.watch(recursive)` 只对少数目录有效，跨平台行为待真机验证（CI 只有 Linux）。
