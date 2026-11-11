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
| 3 | 查看器：本地 web server + 文件监听热重载 | 已完成（2026-11-10，统一进程方案 + 三处修正，记录见 `.agents/implementations/2026-11-10-stage3-web.md`） |
| 4 | 标记：点击选中 + 短号 + 变更高亮 | 已完成（2026-11-10 上线主体；2026-11-11 补齐嵌套层级切换）：点击选中、`#N` 短号、`paintress_marks`、变更高亮、Alt+点击选父级、Alt+滚轮切层级。记录：`.agents/implementations/2026-11-10-stage4-marks.md`、`.agents/implementations/2026-11-11-stage4-nesting.md` |
| 5 | 发布与安装规范化：npm 包、多客户端配置、Registry | **基本完成**（2026-11-11）：已发布 `paintress@0.1.1`（unscoped 根包名），多客户端 `install`/`doctor`/`mcp-config` 已实测；CI 与发布工作流已入仓（OIDC + provenance，action 钉 SHA）；剩 npm 侧配置 trusted publisher、MCP Registry 可选、dts 债。记录：`.agents/implementations/2026-11-11-stage5-publish-prep.md`、`2026-11-11-publish-npm.md` |
| 6 | 画布交互：多画板导航 + 平移缩放 | 已完成（2026-11-11，五步全部落地，记录见 `.agents/implementations/2026-11-11-stage6-canvas.md`）；方案与边界见 `specs/canvas-interaction.md` |

阶段 2 是地基，架构决定成败，其余三阶段都建立在它之上（理由见 `.agents/memory/ARCHITECTURE.md#D-002`）。

## 未决问题

- **dts 生成被禁用（债务）**：zod passthrough 推断类型超过 TS 序列化上限（TS7056，实测定位在 `src/schema/nodes.ts:209` 的 `NodeSchema`）。2026-11-11 实验：只给 `NodeSchema` 加显式注解即可通过构建，但 `index.d.ts` 达 1548 KB（包体从 164 KB → 1.67 MB），故 0.1.0 不发类型产物；要发需先给全部导出 schema 显式注解瘦身，或按需导出 + api-extractor。
- **格式规格存在缺口**（2 处，2026-11-10）：imports 跨文件 id 引用语法缺实例；corner_radius 四元组角顺序未确认。详情与证据标注见 `format/spec.yaml` 的 `ptr.known_gaps`。
- **README 免责声明**：当前 README 不提及任何第三方产品，因此无需声明；若将来在文档中描述性提及格式或产品名，需补「非官方、不隶属」声明。依据见 `specs/pen-format-licensing.md#红线 3`。
