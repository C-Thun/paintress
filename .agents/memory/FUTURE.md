# 远期与延期

> 每条必须写清：是什么、为什么等、什么条件会把它拉回来（触发条件）。
> 被采纳的条目移入 `specs/PLAN.md`，这里留一行指针。

## 会话交接（2026-11-10 末状态）

**代码状态**：`0a22eed`，`tsc` 双端 0 错误，**117 测试全绿**，`pnpm build` 通过（daemon 55 kB + ui 22 kB）。

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

## 阶段 4 剩余 — 嵌套层级切换

**是什么**：目前面包屑可点击跳级，但缺「修饰键点选父级」（如 Alt+点击 选上一层）与滚轮切换层级。

**为什么等**：与画布交互（阶段 6）共用同一层「画布内命中与导航」逻辑，先做画布交互可避免两套实现。

**触发条件**：阶段 6 视口控制器完成后一并做。

## 阶段 5 — MCP 发布与安装规范化

#### 是什么
1. npm 发布：可选 unscoped `paintress`（实测未占用）或 `@aliciai/paintress`（operator 已持有 `@aliciai` scope）
2. 多客户端配置模板写进 README：Claude Desktop / Cursor / VS Code / Codex / pi 各一份
3. 可选：`server.json` 发布到官方 MCP Registry 供发现
4. 文档给两条安装路径：`npx paintress mcp`（便捷）与全局安装（稳定，不受启动时网络影响）

**为什么等**：工具名与参数还会随阶段 4/6 变动。

**触发条件**：阶段 4、6 合并后发布 `0.2.0`。

**已就绪的前置**：GitHub org `aliciai-dev`（display name `Aliciai`）与 npm scope `@aliciai` 均已由 operator 持有，见 `ARCHITECTURE.md#D-005`。

**已知发布阻塞项**（2026-11-11 全新 clone 实测）：
1. `package.json#exports["./mcp"]` 指向 `dist/mcp/server.js`，但 `tsdown.config.ts` 只打包 `src/index.ts`/`src/cli.ts`，该文件从不产出。CLI 走 bundle 不受影响；库方式 `import 'paintress/mcp'` 会失败。
2. `files: ["dist"]` 不含 `ui/dist`，而 daemon 按 `dist/../ui/dist` 定位前端产物（`src/web/daemon.ts:48`）→ 从 npm 安装后 viewer 退化为「前端未构建」精简页。

## 阶段 6 — 画布交互（多画板 + 平移缩放）

**方案已定稿**：`specs/canvas-interaction.md`（现状差距、transform 而非缩放 iframe 的理由、`data-board*` 元数据契约、交互清单、边界、五步顺序）。

**五步顺序**：
1. 渲染器输出 `data-board*` 元数据（顶层节点的 x/y/w/h）
2. 视口控制器（zoom/pan/fit），含坐标换算单测
3. 画板条与聚焦（画板数 ≤1 时隐藏）
4. 快捷键 + localStorage 持久化（按项目+文件）
5. 与短号聚焦联动

**触发条件**：无（operator 已明确要求，是下一个开工项）。

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

## 已否决

- **检测 agent 存活用 PID 轮询**：PID 会被内核复用，必然误判。已改为连接存活（socket 断开即事件）。
- **用 `pen` CLI 或官方 MCP 作为运行依赖**：见 `ARCHITECTURE.md#D-001`。
- **发明新格式后缀 `.penx`**：与活跃项目 PenX 撞名且带 `pen` 前缀。已选 `.ptr`。
- **用 SolidStart**：其 peerDeps 要求 solid-js ^1.9.15，不支持 2.0；且 SSR 对本地工具无价值。已选纯 Solid + Vite。
- **前端叠加第二套变更过期阈值**：过期判定统一由 daemon TTL 负责。
