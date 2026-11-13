# 远期与延期

> 每条必须写清：是什么、为什么等、什么条件会把它拉回来（触发条件）。
> 被采纳的条目移入 `specs/PLAN.md`，这里留一行指针。

## 优先级分层（2026-11-12 盘点）

分层口径：**层一 = 工程量小 或 作用大/已命中触发**，按推荐执行顺序排；层二 = 值得做但要先定一两件小事；
层三 = 等触发或不划算。条目正文仍在各自小节，本表只做指路与排序，不复制细节。

### 层一：下一批就做（按顺序）

2026-11-12 首批六项已全部落地（见 `FINISHED.md#首批六项（2026-11-12）`），当前没有已排序的层一。
下次挑任务从层二里选，或等 operator 直接点单。

### 层二：排得上，但要先定一两件小事

> 2026-11-13 已收口两项：**trusted publishing**（`publish.yml` 用 OIDC + `npm publish --provenance`，无任何 token；`paintress@0.5.2` 在 registry 上带 SLSA 证明）、
> **MCP Registry `server.json`**（入仓，`verify:pkg` 会校验版本号与 package.json 一致）。

| 条目 | 卡在哪 |
| --- | --- |
| 查看器 UI 缺口（只读属性面板 / 多稿切换） | 纯体验增益，可拆成两件分别半天 |

> 2026-11-13 另收口两项：**附注 md 只读视图**（`specs/notes-drawer.md`，画布左侧抽屉）、
> **浏览器端交互回归测试**（`test/ui-interaction.spec.ts`，真实 Chromium 跑构建产物）。

### 层三：等触发或不划算

画谱（Album，大件，等第二个项目压力）；渲染器未实现的规格项（按真实设计稿逐项补）；
VS Code JSONC / Windows `.cmd` / Codex 陈旧路径（都要引入新解析层，等真实报告）；
Vitest → `node:test`（纯偏好）；`dts` 修复（成本高、收益低）。

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

## 画谱（Album）— 项目级预设与组件体系（2026-11-12 拟定）

> **2026-11-13：框架级子集已提前落地**（operator 要求提前到当前阶段）：
> 项目级 `__preset.ptr` / `__components.ptr`、`paintress_preset` / `paintress_component`、
> 查看器里的预设面板与组件画廊。方案与验收见 `specs/project-presets.md`、`specs/components.md`。
> 本节剩下的才是 Album 级能力（跨项目继承、变体/参数、真 ref）。

> operator 2026-11-12 原话：**「这个设计的最关键的一点要提供组件或是预设概念，用于框死一个项目中的颜色，样式，以及一个一个的可复用组件，这块的确立及调整功能作为后面的重点」**。

### 是什么

把「一个项目的颜色、样式、可复用组件」从散落在节点属性里的硬编码，收敛成一份**可锁、可审、可整体调整**的声明。

**一个概念，三层**（不拆成两个概念）：

| 层 | 名称 | 持有 | 今天的等价物 |
| --- | --- | --- | --- |
| 1 | tokens（谱值） | 颜色、字号、间距、圆角、阴影等命名值，**带 kind** | `variables`（现在只有 name→任意值，不区分类型） |
| 2 | presets（谱式） | 按节点类型打包的属性组（正文/标题、按钮外观、卡片容器…），值必须是 token 引用 | 无 |
| 3 | components（谱件） | 可复用组件：定义体 + `ref` 实例 + 插槽/变体 | `reusable` + `ref` + `descendants` |

**为什么不把「定义」和「组件」分开**：三者共享同一批操作（一起确立、一起调整、一起审计），也共享同一把「越界」尺子；更关键的是格式里 token 与组件**已经各占一层**（顶层 `variables` + 节点级 `reusable`/`ref`），再起一个顶层概念只会把「同一个项目的规范」拆成三份互不认识的声明，反而更难框死。

### 约束阶梯（「框死」的实现方式）

```
tokens  ←  presets  ←  components  ←  页面节点实例
```

- token 的值只能是字面量；preset 的属性值只能是 `$token`；component 的外观只能引用 preset；页面节点优先用 preset / 实例。
- 违反任一层：`validate` 出**警告**（不阻断写入，保留一次性设计的手感）；`audit` 列出每个越界节点 + 可替换的 preset 建议。
- 必须留逃生舱：节点显式标记（拟 `metadata.allowLiteral`）后跳过阶梯检查，否则体系会把临时设计卡死。

### 三个操作（后续重点）

| 操作 | 形态 | 能复用的现成能力 |
| --- | --- | --- |
| **establish 确立** | 从已有设计稿提取重复值 → 候选 tokens/presets/components → 人批准后写入 | 节点树 + `data-node-id` |
| **adjust 调整** | 改 token/preset → **dry-run diff**（哪些节点会变、变成什么）→ 应用 | 变更高亮链路（`/api/changes` + `data-ptr-changed`）天然就是 diff 的展示面 |
| **audit 审计** | 越界节点、孤儿 token、从未被用到的 preset | `validate` 的语义检查层 |

「调整」是三者里价值最高的：一次改 token 让全项目跟着变，是这套体系存在的理由；dry-run diff 则是它敢被 AI 调用的前提。

### 命名（拟定，待 operator 定音）

中文 **画谱**，英文 **Album**。锚点：**芥子园画谱** —— 一套可以照着临的规范形与设色，与 paintress 的绘画隐喻是同一套语言。

- **产品名不污染 schema**：JSON 里仍是朴素的 `variables` / `presets` / `reusable`，不出现 `album` 字段（D-005 的命名纪律：名字可以有趣，字段必须无聊）。
- 工具面：`paintress_album`（读）/ `paintress_album_establish` / `paintress_album_adjust` / `paintress_album_audit`。
- 备选：**画底 / ground**（强调「打底决定一切」）、**图谱 / atlas**（强调「图版合集」）。
- 已排除：`palette`（只覆盖颜色）、`stencil`（只像模板）、`theme`（UI 语境里指明暗主题，与画布背景开关撞车）、`codex`（与 OpenAI Codex 撞名）。

### 为什么等

1. `.ptr` 仍是 draft，格式演进要先有真实项目压力再定型（D-006）；
2. `.pen` 层冻结，画谱只做 `.ptr` 侧；
3. 当前 0.3.0 刚补完「看」（画布背景、i18n），先把看顺了再做框。

### 触发条件

- 出现第二个真实项目要复用同一套颜色/组件（现在只有 Alice 一个项目在大量用 `ref`）；
- 或 operator 提出「改一处、全项目跟着变」的操作级需求；
- 或 `validate` 的未知类型 / 未定义变量警告开始被真实设计稿刷屏。

### 未决

- token 的 kind 是否强制？强制后能做单位换算与对照检查，但历史文件迁移变重。
- preset 能否跨文档继承（规格里的 `imports` 仍是 TBD）。
- 变体怎么表达：命名变体（`variant=primary`）还是参数化插槽。
- 画谱放文档顶层（`x-paintress.album`）还是独立文件（一个项目一份、多稿共享）？后者更像「项目级」，但要处理路径解析与版本冲突。

### 手改入口（operator 2026-11-12 补充）

「数值类的，比如颜色之类的，以后也可以提供用户手改的功能，因为只是提供一些输入框。」

- 表现：查看器里开一块画谱面板，token/preset 的值直接是输入框（颜色列取色器 + 十六进制文本，数字列数字输入）；改完走 MCP 同一条写路径（改文档就是改文档，不存在第二套状态）。
- 为什么等：画谱三层结构本身还没定稿（见上），先把「确立/调整/审计」三个操作跑通，UI 才有东西可绑。
- 触发条件：画谱方案被采纳并落地第一版。

## 附注设计稿笔记（同名 Markdown，只读）（2026-11-12）

**是什么**：每个 `.ptr` / `.pen` 可配一份同名 `.md`（如 `home.ptr` → `home.md`），作为这份设计的解析与标注——为什么这么画、哪些是待定项、哪块对应哪个需求。查看器里能读到。

**已定：只查看，不做编辑**（operator 2026-11-12 原话）：
> 「那个 markdown，我想了下不需要做编辑，只要查看就行了，编辑等以后有了需要再说，因为编辑是个大坑，也有足够多的其他工具，何况大多数情况下是 AI 写给自己看的。」

推论（这条直接决定范围）：
- md 是**写给人和 AI 自己看**的产物，写入走普通文件工具（agent 直接写、人用编辑器），paintress 不开写路径；
- 因此不需要：编辑器选型（textarea / CodeMirror / 跳系统编辑器）、落盘权限面、编辑冲突与覆盖保护；
- 查看器只需：发现同名 md → 渲染 → 展示；文件变更走已有 watcher 热重载。

**为什么还等**：查看器信息架构刚稳定（侧栏三段 + 工具条 + 画板条），塞面板前要先定位置；且当前仓库内没有一份同名 md（`demo/hello.ptr` 无 `hello.md`），面板会被空转。

**触发条件**：设计目录里出现 `*.ptr` 与 `*.md` 同名组合，或 operator 想把某份稿的说明放进查看器（当前未命中）。

**未决**：
- 面板位置：侧栏第四段 / 画布上方抽屉 / 文件列表里 md 与 `.ptr` 并列；
- md→HTML 方案：引渲染库（markdown-it / marked）还是自写子集（标题/列表/代码/表格）——前端现在只有 4 个直接依赖，倾向后者；
- 无同名 md 时不显示入口，不给空面板；
- 是否支持 md 里写 `#短号` / 节点 id 并点击跳转到节点（与 marks 联动，可放第二版）。

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

## 已否决

- **检测 agent 存活用 PID 轮询**：PID 会被内核复用，必然误判。已改为连接存活（socket 断开即事件）。
- **用 `pen` CLI 或官方 MCP 作为运行依赖**：见 `ARCHITECTURE.md#D-001`。
- **发明新格式后缀 `.penx`**：与活跃项目 PenX 撞名且带 `pen` 前缀。已选 `.ptr`。
- **用 SolidStart**：其 peerDeps 要求 solid-js ^1.9.15，不支持 2.0；且 SSR 对本地工具无价值。已选纯 Solid + Vite。
- **前端叠加第二套变更过期阈值**：过期判定统一由 daemon TTL 负责。
