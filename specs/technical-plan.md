# 技术方案（草案）

- 状态：技术栈已定（D-004），其余待评审（2026-11-10）
- 依据：`AGENTS.md#核心决策`、`.agents/memory/ARCHITECTURE.md#决策记录`、`specs/PLAN.md#路线`
- 说明：本文只是提案，**每一条都欢迎推翻**。未评审通过前不写入决策记录。

## 一、总体架构

```text
                    ┌─────────────┐
   AI ──MCP──▶      │  mcp layer  │
                    └──────┬──────┘
                           │ 复用
   ┌────────┐   ┌──────────▼─────────┐
   │  cli   │──▶│   ops  (读写/查询)  │──▶ doc (原子写 + 备份)
   └────────┘   └──────────┬─────────┘
                           │
                    ┌──────▼──────┐
   浏览器 ◀──HTML────│ render 纯函数│──▶ shot (截图)
                    └─────────────┘
```

一条纪律：**渲染是纯函数**（`Doc → string`），MCP、CLI、查看器、截图四个出口全部复用它。这是 D-002 的直接兑现。

## 二、逐层选型

| 层 | 选型 | 理由 | 备选与否决原因 |
| --- | --- | --- | --- |
| 语言/运行时 | **TypeScript + Node 22 LTS** | 设计稿 schema 本是 TS 定义；MCP SDK 生态最成熟 | Bun：更快但 MCP/Playwright 兼容性未验证；Rust：开发速度不匹配迭代节奏 |
| 包管理 | **pnpm** | 全局约定 | — |
| MCP | **`@modelcontextprotocol/sdk`**（官方） | 事实标准 | 自写协议层：无收益 |
| 数据校验 | **Zod** | MCP SDK 工具参数本就用 Zod；与 TS 类型同源 | ajv + JSON Schema：多一层转换，且需要维护两份定义 |
| 模式匹配 | **`ts-pattern`**（提案） | 补足函数式表达力：节点类型分派自动收窄，渲染映射更干净 | 不用：手写 `switch` + `never` 检查也能穷尽，但啰嗦 |
| 文档读写 | **`node:fs` + 原子写**（tmp → rename） | 无依赖 | — |
| 并发控制 | **文件锁 + mtime 比对** | 兑现「同一时刻只允许一个写者」 | 无锁：静默覆盖，不可接受 |
| 渲染 | **纯函数输出 HTML + 内联 CSS** | D-002；浏览器即布局引擎 | SVG 直出：flex 布局要自己实现，等于重写浏览器；Canvas：不可点击、不可检查 |
| 布局映射 | **CSS Flexbox** | `.pen` 的 `layout/gap/padding/alignItems/justifyContent` 与 flexbox 几乎同构 | — |
| 截图 | **Playwright（chromium）** | 稳定性好于 puppeteer，自带浏览器管理 | `chrome-headless-shell` + CDP：省体积但要自己管版本 |
| 图标 | **`lucide-static`（SVG 字符串）** | 官方支持 lucide 库；其他库按需加 | 图标字体：无法着色和裁切 |
| 查看器服务 | **`node:http` + 原生前端 JS** | 功能只有渲染、点击、高亮，不需要框架 | Fastify/Preact：当前规模是过度设计，留待需要时再换 |
| 热重载 | **`chokidar` + SSE** | SSE 比 WebSocket 简单，单向推送足够 | WebSocket：双向用不上 |
| 测试 | **Vitest** | 与 TS 原生配合；渲染器可用 HTML 快照测试 | Jest：配置更重 |
| 构建 | **`tsdown`** 打包为单文件 bin | 输出 `ptr` 命令 | 直接跑 TS：启动慢，分发不便 |
| 许可证 | MIT（项目）/ 依赖全部 MIT·Apache-2.0·ISC 兼容 | 与现有 LICENSE 一致 | — |

## 三、关键设计决策（需要您拍板的部分）

### 决策 1：MCP 工具粒度 —— 细粒度，不做 JS 沙箱

**提案**：提供结构化工具，而不是一个能执行任意 JS 的 `execute`。

```text
ptr_doc_info      文档摘要：版本、节点数、变量、顶层框架
ptr_query         条件查询：type / name / 正则 / 祖先路径 → 扁平列表
ptr_get           取单个节点子树（可选深度）
ptr_update        浅合并属性
ptr_insert        插入子节点（父 + 可选 index）
ptr_delete        删除节点
ptr_move          移动/重排
ptr_validate      校验并返回告警（不阻断）
ptr_render        渲染为 HTML，返回路径
ptr_screenshot    截图 PNG，返回路径
ptr_mark          标记与短号映射（阶段 4）
```

**为什么不做沙箱**：沙箱灵活，但（a）无法静态校验，写坏文件的风险高；（b）AI 每次都要生成可执行代码，token 成本高于结构化参数；（c）审计困难，出了错无法复盘是哪个操作导致的。

**例外**：`ptr_batch` 接受结构化操作数组，一次校验、一次写入，用于「一轮改动」的原子提交。

### 决策 2：渲染映射规则

| `.pen` | HTML/CSS |
| --- | --- |
| 父 `layout: "none"` | 子节点 `position:absolute; left:x; top:y` |
| 父 `layout: "vertical" / "horizontal"` | `display:flex; flex-direction:<column/row>` |
| `gap` | `gap` |
| `padding` | `padding`（支持 1/2/4 值形式） |
| `justifyContent` | `justify-content`（`space_between` → `space-between`） |
| `alignItems` | `align-items` |
| `width/height: "fit_content"` | `max-content`（主轴）/ `fit-content`（交叉轴） |
| `width/height: "fill_container"` | `flex:1`（主轴）/ `stretch`（交叉轴） |
| `width/height: 数值` | 固定像素 |
| `fill` 字符串或 `$变量` | `background`（变量查 `variables` 表后内联） |
| `cornerRadius` | `border-radius` |
| `stroke` + `strokeWidth` | `border` 或 `outline`（按 `strokeAlignment`） |
| `effect`（shadow/blur） | `box-shadow` / `filter` |
| `text` + `textGrowth` | `white-space` 与 `max-width` 组合 |

`data-node-id` 挂在每个输出元素上，`data-node-type` / `data-node-name` 作为调试辅助。

### 决策 3：尺寸与文字度量的处理顺序

**提案**：第一版**不自己算文字**，交给浏览器。

- 渲染时只写声明式 CSS，换行、行高、字距全部由浏览器排版。
- 需要「AI 知道某节点实际渲染尺寸」时，提供一个 `ptr_measure`：用 Playwright 打开渲染结果，读 `getBoundingClientRect()` 回填。
- 这样避免引入字体度量引擎（最脏的部分），代价是测量慢约 1 秒/次。

**如果将来必须离线测量**：再引 `opentype.js` + 字体文件，作为可选模块。

### 决策 4：变量解析的时机

- **渲染时解析**（推荐）：`$accent` 在输出 HTML 前替换为具体值，HTML 里不保留变量。
- 备选：输出 CSS 自定义属性 `var(--accent)`，便于整体换主题。
- **建议**：两者都支持，用参数切换。默认内联（所见即所得，截图准确）。

### 决策 5：`ref` 组件实例

- 第一版：渲染前**展开**为完整子树（在内存里展开，不改文件）。
- 代价：大文档内存占用上升；收益：渲染逻辑不必区分实例与普通节点。
- 阶段 1 工具层仍保留 `ref` 原样，只有渲染器展开。

### 决策 6：文件写入的安全性

1. 写前备份到 `/tmp/ptr-backup-<时间戳>/`（可配置）。
2. 写临时文件 → `fsync` → `rename` 覆盖（原子）。
3. 写前比对 `mtime`，与读取时不一致则拒绝并提示「文件已被其他程序修改」。
4. 可选文件锁（`flock`），防止同机并发进程。

### 决策 7：版本兼容策略

- 读取时记录 `version`，**高于**本工具已知版本 → 警告但仍尝试读取（宽松透传未知字段）。
- 写入时保持原 `version` 不变，除非显式执行迁移命令。
- 未知节点类型：保留原样、渲染为占位框，不静默丢弃（避免「打开→保存→丢数据」）。

## 四、目录结构（提案）

```text
paintress/
├── src/
│   ├── schema/        # Zod 定义 + 校验（独立撰写，不抄官方文本）
│   ├── doc/           # 解析、原子写、备份、版本
│   ├── ops/           # 查询与变更操作
│   ├── render/        # Doc → HTML（纯函数）
│   ├── shot/          # Playwright 截图与测量
│   ├── mcp/           # MCP server 与工具定义
│   ├── viewer/        # 本地 web 查看器 + 热重载
│   └── cli/           # ptr 命令行入口
├── test/
│   ├── fixtures/      # 真实设计稿样本（脱敏）
│   └── snapshots/     # 渲染 HTML 快照
└── docs/
```

## 五、难点与风险

| 难点 | 影响 | 应对 |
| --- | --- | --- |
| 尺寸语义（`fit_content` / `fill_container` 在主/交叉轴行为不同） | 渲染错位 | 单独写映射表 + 快照测试覆盖每个组合 |
| 文字换行与字体回退 | 与原作者排版有差异 | 第一版接受差异；字体族显式写入 CSS，锁定可用字体 |
| `ref` 嵌套覆盖（`descendants` 路径语法） | 组件实例渲染错误 | 展开器单独测试，覆盖 `a/b` 路径与整节点替换 |
| 大文档性能（1MB / ~2000 节点） | 渲染与截图变慢 | 渲染纯字符串拼接（不做 DOM 操作）；截图按需触发 |
| schema 漂移 | 旧文件读不了 | 版本探测 + 未知字段透传 + 迁移命令 |
| 未知节点类型（`script` / `browser` / shader） | 渲染缺失 | 占位框 + 控制台告警，不阻断 |

## 六、阶段与产出

| 阶段 | 交付 | 验收方式 |
| --- | --- | --- |
| 1 | `ptr` CLI + MCP：读/查/改/插/删/校验 | 对真实设计稿做一轮改动，`git diff` 只有预期行；round-trip（读→写）字节级稳定 |
| 2 | 渲染器 + 截图 | 取 3 个真实设计稿，渲染 HTML 与截图人工比对；关键页像素差异肉眼不可辨 |
| 3 | 查看器 + 热重载 | 浏览器打开本地服务，改文件后 1 秒内刷新 |
| 4 | 标记 + 短号 + 变更高亮 | 点两下得到 `#N`，MCP 返回映射；改完自动高亮受影响节点 |

## 七、待定项

1. **技术栈已定**：TypeScript + Node 22 LTS（`2026-11-10`，见 `.agents/memory/ARCHITECTURE.md#D-004`）。
2. **CLI 命令名**：`ptr` / `paintress` / 其他。
3. **是否第一版就支持 `imports`**（跨文件引用）——提案：不做，只做单文件。
4. **渲染输出用内联样式还是 class + `<style>`**——内联便于复制，class 更省体积。提案：class + `<style>`，因为截图和查看都只需要一份。
5. **是否内置一个 HTTP 渲染接口**（供外部工具复用）——提案：不做，避免过早暴露。
