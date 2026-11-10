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

**仍待决策/未完成**：
- 包名：优先试 unscoped `paintress`（相似度过滤可能 403），失败回退 `@aliciai/paintress`。
- `dts` 仍失败（`NodeSchema` TS7056），0.1.0 不发类型产物。
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

## 已否决

- **检测 agent 存活用 PID 轮询**：PID 会被内核复用，必然误判。已改为连接存活（socket 断开即事件）。
- **用 `pen` CLI 或官方 MCP 作为运行依赖**：见 `ARCHITECTURE.md#D-001`。
- **发明新格式后缀 `.penx`**：与活跃项目 PenX 撞名且带 `pen` 前缀。已选 `.ptr`。
- **用 SolidStart**：其 peerDeps 要求 solid-js ^1.9.15，不支持 2.0；且 SSR 对本地工具无价值。已选纯 Solid + Vite。
- **前端叠加第二套变更过期阈值**：过期判定统一由 daemon TTL 负责。
