# 计划（未完成）

> 只放路线级计划与未决问题。每个工作单元开工前单独写 `specs/<unit>.md`；
> 已收口的工作移入 `.agents/memory/FINISHED.md`，只留摘要与证据指针。
> 进度本身只在 todo 工具里——这里不写。

## 路线

迁移自 `AGENTS.md`（2026-11-10）。

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | MCP 工具：读 / 查 / 改 / 插 / 删 / 校验 | 已完成（2026-11-10，9 工具 + CLI，记录见 `.agents/implementations/2026-11-10-stage1-core.md` 与 `-stage1-mcp-cli.md`） |
| 2 | 渲染器：`.pen` → HTML/CSS，+ headless 截图出 PNG | 已完成（2026-11-10，视觉验收通过，记录见 `.agents/implementations/2026-11-10-stage2-render.md`） |
| 3 | 查看器：本地 web server + 文件监听热重载 | 未开始 |
| 4 | 标记：点击选中 + 短号 + 变更高亮 | 未开始 |

阶段 2 是地基，架构决定成败，其余三阶段都建立在它之上（理由见 `.agents/memory/ARCHITECTURE.md#D-002`）。

## 未决问题

- **dts 生成被禁用（债务）**：zod passthrough 推断类型超过 TS 序列化上限（TS7056，见 src/schema/document.ts、nodes.ts）。发布 npm 前需给导出 schema 加显式类型注解或换 api-extractor，再恢复 `--dts`。
- **格式规格存在缺口**（2 处，2026-11-10）：imports 跨文件 id 引用语法缺实例；corner_radius 四元组角顺序未确认。详情与证据标注见 `format/spec.yaml` 的 `ptr.known_gaps`。
- **README 免责声明**：当前 README 不提及任何第三方产品，因此无需声明；若将来在文档中描述性提及格式或产品名，需补「非官方、不隶属」声明。依据见 `specs/pen-format-licensing.md#红线 3`。
- **框架文件尚未提交**（延期）：`.agents/memory/` 下文件均为未跟踪状态（`framework_audit` W-STATE-01，2026-11-10）。等 operator 决定提交时机与提交信息；这不是缺陷，是安装后的预期状态。
