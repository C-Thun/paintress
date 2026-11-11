# 远期与延期

> 每条必须写清：是什么、为什么等、什么条件会把它拉回来（触发条件）。
> 被采纳的条目移入 `specs/PLAN.md`，这里留一行指针。

## 会话交接（2026-11-11 更新）

**代码状态**：`tsc` 双端 0 错误，**137 测试全绿**（10 文件），`pnpm build` 通过（daemon 56 kB + ui 28 kB）。阶段 6 已完成，见 `FINISHED.md`。

**已可用的完整链路**（新会话可直接演示）：

```bash
pnpm build                                   # 构建 daemon + ui
node dist/cli.js web --daemon --idle 3600000 # 起 daemon（唯一实例）
node dist/cli.js watch demo ./demo           # 注册项目
# 浏览器打开 http://localhost:3316/?project=demo&file=hello.ptr
node dist/cli.js update demo/hello.ptr <id> '{"content":"x"}'  # 改完前端自动高亮
```

**踩过的坑（新会话别重复）**：

1. `web --daemon` 偶发起不来（锁/端口残留）。可靠做法：`nohup node dist/cli.js web --idle 3600000 > /tmp/daemon.log 2>&1 &`，然后 `node dist/cli.js ping` 确认。
2. `stop` 之后立刻 `web --daemon` 可能撞上旧进程；先 `ps -eo pid,cmd | grep 'cli.js web'` 确认并 `kill`。
3. **改了 `src/` 必须重启 daemon** 才生效（否则 `/api/*` 会是旧路由，表现为「未知 API」）。
4. 测试里 `idle 自动退出` 用例会重启 daemon（端口变化），后续用例必须同步 `baseUrl`。
5. iframe 的 `sandbox` 必须含 `allow-scripts`，否则父页面在 `contentDocument` 上绑的点击回调会被 Chrome 拦截并报 `Blocked script execution`。
6. **父页面与 iframe 是两个 document，键盘事件不跨**：视口的空格平移要在两处都转发（`ViewportBinding.setSpace`），否则焦点在侧栏时按空格无效。

## 阶段 4 剩余 — 嵌套层级切换

已完成（2026-11-11）：摘要见 `FINISHED.md#阶段 4 剩余 — 嵌套层级切换（2026-11-11）`，实现记录 `.agents/implementations/2026-11-11-stage4-nesting.md`。

注：原条目写的「普通滚轮切换层级」与阶段 6 的滚轮缩放冲突，已裁决为 **Alt+滚轮**；理由与行为表在上述实现记录里。

## 阶段 5 — MCP 发布与安装规范化

#### 是什么
1. npm 发布：可选 unscoped `paintress`（实测未占用）或 `@aliciai/paintress`（operator 已持有 `@aliciai` scope）
2. 多客户端配置模板写进 README：Claude Desktop / Cursor / VS Code / Codex / pi 各一份
3. 可选：`server.json` 发布到官方 MCP Registry 供发现
4. 文档给两条安装路径：`npx paintress mcp`（便捷）与全局安装（稳定，不受启动时网络影响）

**为什么等**：工具名与参数还会随阶段 4/6 变动。

**触发条件**：阶段 4、6 合并后发布 `0.2.0`。

**已就绪的前置**：GitHub org `aliciai-dev`（display name `Aliciai`）与 npm scope `@aliciai` 均已由 operator 持有，见 `ARCHITECTURE.md#D-005`。

**原发布阻塞项 → 已解决**（2026-11-11，记录见 `.agents/implementations/2026-11-11-stage5-publish-prep.md`）：
1. ~~`exports["./mcp"]` 指向不产出的文件~~ → tsdown 增加 `src/mcp/server.ts` 入口。
2. ~~`files` 缺 `ui/dist`~~ → 已加入；`prepack` 额外跑 `verify:pkg` 自检。
3. ~~bin 经符号链接执行时静默退出~~ → 入口判定改 `realpath` 比对。

**进度**（2026-11-11）：
- 包名已定：**unscoped `paintress`**，0.1.0 首发、0.1.1 修帮助行，`latest = 0.1.1`（记录 `2026-11-11-publish-npm.md`）。
- 发布用 bypass-2FA granular token（All packages）；**2027-01 起该能力失效**，必须迁 trusted publishing（OIDC）或 staged + 2FA 批准。
- `dts` 仍失败（`NodeSchema` TS7056），0.1.x 不发类型产物。
- 可选：`server.json` 发布到 MCP Registry；pi 的 `~/` 路径写法需真会话验证。

## 阶段 6 — 画布交互

已完成（2026-11-11）：摘要见 `FINISHED.md#阶段 6 — 画布交互（2026-11-11）`，实现记录 `.agents/implementations/2026-11-11-stage6-canvas.md`；方案留在 `specs/canvas-interaction.md`。

## 技术债与待评估

### 渲染器未完整实现的规格项

- `mesh_gradient` 填充：降级为首个顶点色 + 警告
- `shader` 填充与效果：跳过 + 警告
- 弧形椭圆（`startAngle`/`sweepAngle`）、环形（`innerRadius`）：按整圆/实心渲染 + 警告
- 多边形圆角：忽略
- `strokeAlignment` 的 center/outer：按 inner（CSS border）语义
- 图标库：仅 lucide / feather
- 文字度量：全部交给浏览器，无离线测量
- `imports` 跨文件引用：未实现（规格里标 TBD）

**触发条件**：真实设计稿出现且影响可读性时逐项补。

### 查看器 UI 缺口（阶段 6 之外）

- 只读属性面板
- 同项目多设计稿之间的快速切换（现在是平铺列表）

### 变更高亮的已知边界

- `notifyChanges` 非阻塞 + 2s 超时，极端情况可能丢通知（高亮是尽力而为，不影响写入）
- 若将来需要强保证：改为短超时 `await`（会拖慢写路径，需权衡）

### 测试框架选型偏置

当前用 Vitest；项目只用到 `describe`/`it`/`expect`，`node:test` 完全够用。迁移约半天。
**触发条件**：operator 认为依赖体积/供应链复杂度是问题时做；否则保持。

### 评审遗留（2026-11-12，来源 `.agents/implementations/2026-11-12-code-review-fixes.md`）

#### 查看器交互缺浏览器端回归

**是什么**：拖拽平移、修饰键、快捷键、视口持久化、层级切换目前只有纯数学单测 + 一次性临时脚本验证，没有入库的端到端用例。

**为什么等**：需要复用 daemon 启动与 fixture 项目（`test/web.spec.ts` 已有骨架），约半天；但这几处交互每改一次都要手测一轮，成本会反复支付。

**风险**：属于当前最大的测试缺口——交互回归不会被执行 CI 拦住。

**触发条件**：下次改动 `ui/src/frame-viewport.ts` 或 `App.tsx` 的交互逻辑时一并补；或出现一次漏到发布版本的交互回归。

#### VS Code `mcp.json` 的 JSONC 支持

**是什么**：`install` 用严格 JSON 解析配置，带注释的 `mcp.json` 会判为 `invalid` 并跳过（安全，但不生效）。

**为什么等**：正确做法不是“解析后重新序列化”（会丢掉用户注释），而是用 jsonc-parser 做定点插入；换解析层属于行为变更，需单独验证。

**触发条件**：有用户因 VS Code 已有注释配置而接入失败；或新增第 6 家客户端时统一升级写入层。

#### Windows 的 `.cmd` 垫片判定偏松

**是什么**：`resolveLaunchCommand` 在 win32 上只要 PATH 存在 `paintress.cmd` 就当作自己，不校验它指向哪个包。

**为什么等**：Windows 未实测，仓库 CI 只有 Linux；收紧需要解析 npm 的 `.cmd` 垫片或比对 `where` 结果。

**触发条件**：宣布支持 Windows；或出现“写进配置的裸命令指向了另一个 paintress”的报告。

#### Codex 已有条目只判存在、不修陈旧路径

**是什么**：已有 `[mcp_servers.paintress]` 一律 `noop`，即使里面的 `command` 已经过期（例如从 npx 换成全局安装）。

**为什么等**：改 TOML 需要引入解析器（如 smol-toml）并重写 section，风险高于 JSON 合并；当前策略是“只追加不改写”。

**触发条件**：用户报告 Codex 走旧路径；或 install 需要支持“更新已有条目”的语义。

#### 变更通知测试依赖固定等待

**是什么**：`test/changes.spec.ts` 用 400ms 固定等待等 daemon 非阻塞通知，偶发时序失败（2026-11-12 全量跑出现过一次，单测与重跑均通过）。

**为什么等**：与本轮改动无关的既有问题；改法是换成轮询断言，成本很低但需单独验证不引入 flake。

**触发条件**：再出现一次 flake，或 CI 因它变红。

## 已否决

- **检测 agent 存活用 PID 轮询**：PID 会被内核复用，必然误判。已改为连接存活（socket 断开即事件）。
- **用 `pen` CLI 或官方 MCP 作为运行依赖**：见 `ARCHITECTURE.md#D-001`。
- **发明新格式后缀 `.penx`**：与活跃项目 PenX 撞名且带 `pen` 前缀。已选 `.ptr`。
- **用 SolidStart**：其 peerDeps 要求 solid-js ^1.9.15，不支持 2.0；且 SSR 对本地工具无价值。已选纯 Solid + Vite。
- **前端叠加第二套变更过期阈值**：过期判定统一由 daemon TTL 负责。
