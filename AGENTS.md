# paintress

> **记忆契约**：长期记忆在 `.agents/memory/`，写记忆前先读 `.agents/memory/README.md`。
> 一个事实一个家：需要复述事实时写指针 `path#section`，不要复制第二份。
> `AGENTS.md` 只留每个会话都需要的不变量与索引，细节放对应记忆文件。

## 项目定位

paintress 是设计稿的**无界面操作层**：用 MCP 工具让 AI 直接读写设计稿，用 HTML 渲染出来给人看，在浏览器里查看和标记。

不是编辑器。没有拖拽画布、没有图层面板、没有属性检查器。

名字取自《光与影：33 号远征队》的**绘母**（Paintress），亦作「女性绘师」。CLI 命令名用全称 `paintress`——面向 AI 调用，不做短别名。设定与命名决策见 `.agents/memory/ARCHITECTURE.md#D-005`。

## 依赖边界

设计稿是明文 JSON，schema 有公开定义，通用工具即可读写；paintress 只依赖这一层。

**不引入任何商业设计工具的 SDK、账号或托管服务作为依赖。** 技术边界见 `.agents/memory/ARCHITECTURE.md#D-001`。

## 核心决策（改动前必须先讨论）

1. **沿用既有设计稿格式（`.pen`），不发明新格式。**
   旧资产零迁移、格式已被验证、省掉整个格式设计阶段。
   写入侧：**`.ptr` 是标准格式**（新建一律 `.ptr`），`.pen` 完全兼容、原地编辑；分层的理由见 `.agents/memory/ARCHITECTURE.md#D-006`。

2. **渲染器第一版就输出 HTML，不是 PNG。**
   每个节点必须带 `data-node-id`（真实节点 id）。这是把后续「查看器 / 点击选中 / 变更高亮 / 转代码」全部变成增量的关键一步。PNG 只是附属出口，专供 AI 看图。

3. **两个消费者分开**：人要 HTML（可缩放、可点击），AI 要 PNG（截图）。

4. **不做编辑器 UI。** 只有在 web 上「看」和「标记」，没有拖动改布局。

5. **代号是会话级的，不落盘。**
   点击节点 → 分配短号 `#1` `#2` → MCP 返回 `#1 → <id> (<name>)` 映射。跨会话作废，避免编号漂移改错东西。

## 纪律

- **写前备份**：`cp x.pen /tmp/x.pen.bak-$(date +%s)`。
- **同一时刻只允许一个写者**：禁止与其他编辑器或 agent 并发改同一文件，旧 buffer 保存会覆盖结果。
- 设计稿明文可读，**允许**用 `jq` / `grep` 做只读探查与统计；写入一律走 paintress 自己的工具或代码，不手搓 JSON 字符串。
- 格式 schema 存在不兼容变更：跨版本处理旧文件前先保留副本。
- 文件路径用**基于项目根的相对路径**；`fileToken` 是 UUID，新建文档时生成合法 UUID。

## 发版边界：agent 只管代码（operator 2026-11-13）

**职责划分，不跳步：**

| 动作 | 谁做 |
| --- | --- |
| 改代码、改测试、跑 `pnpm check` / `pnpm test` / `pnpm build` | agent |
| **验证通过后提交（`git commit`）** | agent |
| `git push` / 打 tag | **崔总** |
| `npm publish` / 改 `package.json` 的版本号 | **崔总** |
| `npm install -g .` 等全局安装、重启常驻进程 | **崔总** |

- 提交前必须自证：类型检查、测试、构建三条都过；只跑了一部分就在报告里说清楚「没跑什么、为什么」。
- 提交信息用英文祈使句 + 简短正文，一次提交收一个完整改动；不要顺手把无关文件带进去。
- **不要自己做**：升版本号、`npm version`、`npm publish`、`git push`、全局安装、杀掉或重启机器上正在跑的 daemon。
  需要这些时，把要执行的命令写进报告，交给崔总。
- 崔总明确说了「先不装/先不发」时，改动就留在工作区或本地提交里，不要绕道用 `npm link`、`pnpm add -g` 变相生效。

## 索引

### 格式

| 文件 | 持有 |
| --- | --- |
| `format/spec.yaml` | 设计稿格式规格（唯一事实来源；pen_profile 冻结，ptr 段演进） |
| `format/README.md` | 规格导读与分层规则 |

### 计划

| 文件 | 持有 |
| --- | --- |
| `specs/PLAN.md` | 路线级计划与未决问题 |
| `specs/<unit>.md` | 单个工作单元：需求、方案、验收 |

### 记忆

| 文件 | 持有 |
| --- | --- |
| `.agents/memory/README.md` | 记忆契约（写前必读） |
| `.agents/memory/ARCHITECTURE.md` | 分层、决策记录 |
| `.agents/memory/FINISHED.md` | 已收口的工作 |
| `.agents/memory/FUTURE.md` | 延期、被拒、待触发 |
| `.agents/implementations/` | 变更记录，一变更一记录 |
