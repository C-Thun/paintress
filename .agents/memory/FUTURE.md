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

## 画谱（Album）— 项目级预设与组件体系（2026-11-12 拟定）

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

## 附注设计稿笔记（同名 Markdown）（2026-11-12）

**是什么**：每个 `.ptr` / `.pen` 可配一份同名 `.md`（如 `home.ptr` → `home.md`），作为这份设计的解析与标注——为什么这么画、哪些是待定项、哪块对应哪个需求。查看器里找个位置打开查看，也支持改几笔。

**定位**：先做查看为主、轻量编辑为辅。不做通用编辑器，不抢编辑器市场——就是「设计稿旁的一页纸」。

**为什么等**：
1. 查看器的信息架构刚稳定（侧栏三段 + 工具条），塞面板前要先定「笔记在哪打开」——侧栏、抽屉、还是画布上方浮层；
2. 编辑能力需要选渲染方案（纯预览 + 跳系统编辑器，还是 textarea，还是 CodeMirror），重量差别很大；
3. 独立价值低：没有笔记文件时面板空转，适合等真实使用里「想给稿子写说明」的冲动出现后再做。

**触发条件**：operator 或协作者开始在项目里手写设计说明 md；或出现「AI 改完稿、人补充背景信息」的双向工作流需求。

**未决**：
- md 与设计稿的关联按文件名约定还是显式注册（约定简单，重命名会断链）；
- 编辑后的落盘走 daemon（要开写权限面）还是提示用户在编辑器里改；
- 是否支持在 md 里用 `#短号`/节点 id 引用具体节点，点击跳转（那就要和 marks 联动）。

## 画板级截图导出（2026-11-12）

**是什么**：`paintress_screenshot` 目前只出整张画布的 PNG。补一个「选一个画板（board，即顶层 frame，一个画布里的一个页面）导出 PNG」的能力——MCP 形态，AI 说「把登录页导出成图」就能拿到那一块的图。

**命名口径**：代码与渲染层已用 **board / 画板**（`data-board-*` 属性、查看器画板条），沿用，不再发明「page」新词。

**方案草案**（实现时展开成 spec）：
- 参数加可选 `board`（id 或 name）；命中时 viewport 与 clip 都收到该 board 的包围盒（渲染层已有 `data-board-x/y/w/h`，坐标现成）。
- 匹配规则：id 精确命中优先，其次 name 精确，再 name 模糊；多个命中时报歧义错误并列出候选，不猜。
- CLI 对应 `paintress shot <file> <out.png> [--board id|name] [--scale n]`。

**为什么等**：截图主链路（渲染→Chromium→PNG）已稳定，改的是选择子；但当前没有真实需求方在等（AI 看整图已够用），适合与下一次 shot 层改动合并做。

**触发条件**：AI 工作流里出现「只要某一页的图」的表述；或查看器要加「导出此画板」按钮（同一套选择子可复用）。

## 项目解绑与进程关停（2026-11-12）

> operator 2026-11-12 原话：「我之前要做的退 agent 后进程丢了自动 dettach 没成功，watch 项目一直挂着。这个要解决的同时，也要加通过命令行，通过 web 界面的项目列表内手动 dettach 项目的能力。paintress 指令确认有没有提供手机关闭后台程序（不是解绑项目目录，关 web 进程）的能力」

### 现状（2026-11-12 核实）

| 能力 | CLI | web 界面 |
| --- | --- | --- |
| 解绑单个项目 | ✅ `paintress unwatch <name>` | ❌ 无按钮 |
| 关 web 进程 | ✅ `paintress stop`（关 daemon，非解绑） | ❌ 无入口 |
| agent 退出后自动解绑 | ❌ 未实现（见下） | — |

### 1. agent 退出后自动解绑（真正的 bug）

**是什么**：agent 的 attach 连接断开只把 `agents.size` 归零，项目本体仍留在注册表里——「watch 项目一直挂着」就是这个。daemon 只在**全部**项目 idle 时才整体自灭，单个项目永不退场。

**方案草案**：注册表记录「谁注册的」——自动注册（autoRegister）的项目带 owner 标记；该项目的最后一条 agent 连接断开且无浏览器在看时，宽限期（拟 30–60s，给重启 agent 留活路）后自动 unwatch。手动 `watch` 进来的项目不自动退场（人显式绑的，人显式解）。

**风险点**：agent 崩溃重启的窗口期会被误判退场 → 宽限期必须存在；浏览器在看时永不自动解绑。

**触发条件**：高——operator 已被坑过（2026-11-12），属于「下次动 daemon 就修」级。

### 2. web 界面手动解绑

**是什么**：项目列表每项加「解绑」入口（悬停出现的轻量图标，不占常规空间），点击 → 调 daemon 的 unwatch → 走已有的注册表 SSE 自动刷新。当前项目被解绑时前端已有回退逻辑（清选中态），无需新写。

**为什么等**：daemon 侧 API 现成（socket `unwatch`），缺的是 HTTP 面（`DELETE /api/projects/:name`）+ UI 按钮；与 #1 同域，适合一次动完。

**触发条件**：与 #1 一起做。

### 3. 手机/浏览器关停 web 进程

**是什么**：查看器里加「关闭服务器」入口（拟放侧栏底部），点 → `POST /api/shutdown` → daemon 走现有 shutdown 流程。手机经隧道/反代打开页面时，关掉后台进程不用回终端。

**安全考量**：web 只绑 127.0.0.1，能打开页面的都是本机或经隧道的人；但关停是破坏性动作 → 按钮需二次确认（拟对话框列出将断开的连接数）。

**为什么等**：独立小功能，但破坏性动作值得单独一轮验证（误触、SSE 断开后的 UI 状态），不与 #1/#2 搅在一起。

**触发条件**：#1/#2 落地后；或 operator 下次从手机用时提到。

## 变更高亮柔化与版本升级提示（2026-11-12）

### 1. 变更高亮（金色外框）柔化

**是什么**：AI 刚改完的节点现在被标 2px 实心金框 + 3 轮脉动（`ui/src/App.tsx` 里 `data-ptr-changed` 的 inset box-shadow）。operator 觉得有特色但太强。

**方案**（operator 2026-11-12 原话：「边框线粗细降一点然后做一个舒缓的 25% 到 100% 的透明度循环变化」）：
- 粗细 2px → 1px；
- 脉冲改为透明度循环：box-shadow 用 `rgba(144,128,48,1)` 与 `rgba(144,128,48,.25)` 之间往返，「舒缓」→ 周期放慢（拟 2s）且持续循环。高亮注入后持续到下次刷新；变更记录源另有 60s TTL（`src/web/changes.ts`），不是「3 轮后自动消失」。
- 只动 `ui/src/App.tsx` 里注入 iframe 的那段 CSS，不动渲染层。

**触发条件**：低门槛 cosmetic，下次动查看器 UI 顺手做。

### 2. 版本升级提示

**是什么**：npm 上有新版本时，web 页面左上角版本徽章区（现在只有一个灰底当前版本号）变成上下两层：上层当前版本、下层相同尺寸加粗的锈红新版本号（偏橙的红，锈红；与品牌金/蓝区分），点击弹窗：
- 上：一句可复制的提示词——简短的「让 AI 去升级 paintress」的指令；
- 下：GitHub 首页地址。

**技术草案**：
- 版本来源：daemon `/api/projects` 已返回 `version`（当前进程版本）；新版号需要一次外部查询——拟 `GET https://registry.npmjs.org/paintress/latest`（daemon 侧定时或启动时查一次，缓存，失败静默降级为现状）；
- 网络策略：查询失败/离线时绝不打扰（保持单层徽章）；查看器是本地工具，不能因 npm 不可达变慢或报错；
- 提示词文案待 operator 过目，方向：「让 AI 执行 `npm install -g paintress@latest` 并重启 MCP 会话」这类一句话；
- 弹窗用现有 ghost 风格，不引入新组件库。

**为什么等**：涉及外部网络请求与文案定稿，且 daemon 需要新增版本探测路由；不阻塞任何现有功能。

**触发条件**：下一次发版前落地（否则发版后用户不知道该升）；或 operator 催。

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

**状态**（2026-11-12）：触发条件已命中 —— 再次全量跑时 `batch 插入的新节点 id 也会被记录` 失败一次（单跑与重跑均绿）。仍未修，待下一次动 `src/web/changes.ts` 时一并换成轮询断言。

## 已否决

- **检测 agent 存活用 PID 轮询**：PID 会被内核复用，必然误判。已改为连接存活（socket 断开即事件）。
- **用 `pen` CLI 或官方 MCP 作为运行依赖**：见 `ARCHITECTURE.md#D-001`。
- **发明新格式后缀 `.penx`**：与活跃项目 PenX 撞名且带 `pen` 前缀。已选 `.ptr`。
- **用 SolidStart**：其 peerDeps 要求 solid-js ^1.9.15，不支持 2.0；且 SSR 对本地工具无价值。已选纯 Solid + Vite。
- **前端叠加第二套变更过期阈值**：过期判定统一由 daemon TTL 负责。
