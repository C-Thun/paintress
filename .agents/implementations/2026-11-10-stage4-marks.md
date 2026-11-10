# 阶段 4：点击选中 + 会话短号（2026-11-10）

- 范围：`specs/PLAN.md` 阶段 4 的前两项——点击选中与短号映射（变更高亮、嵌套层级切换仍为后续）。
- 兑现：渲染器当初埋的 `data-node-id` 在此处派上用场。

## 变更清单

| 文件 | 内容 |
| --- | --- |
| `src/shared/api-types.ts`（新增） | 前后端共享的类型契约 `Mark` / `MarkInput`，纯类型、无运行时依赖 |
| `src/web/marks.ts`（新增） | `MarksStore`：nodeId → 短号；同项目同节点复用短号；全局递增（跨项目不重复）；daemon 内存态，退出即清空 |
| `src/web/protocol.ts` | 控制面新增 `marks` / `mark` / `clear-marks` 请求与对应响应 |
| `src/web/daemon.ts` | 实例化 `MarksStore`；新增 `/api/marks`（GET/POST/DELETE，含 body 读取与 64KB 上限）、控制面 case |
| `src/mcp/tools.ts` | 新增 `paintress_marks`：list / clear，供 AI 读取「#N → 节点 id」映射 |
| `ui/src/api.ts` | `fetchMarks` / `addMark` / `clearMarks`；类型从 `src/shared` 引用（不重复定义） |
| `ui/src/App.tsx` | iframe 同源接管：点击命中 `closest('[data-node-id]')`、注入高亮样式、祖先链面包屑、侧栏标记列表、清空 |
| `ui/src/styles.css` | 标记区、短号徽标、面包屑样式 |

## 关键实现

1. **iframe 交互**：`sandbox="allow-same-origin allow-scripts"`。父页面通过 `contentDocument` 绑定 click/mousemove，命中检测一行 `closest('[data-node-id]')`；高亮通过注入 `<style>` + `data-ptr-selected` 属性实现，不修改渲染产物。
   - 实测：**只给 `allow-same-origin` 时，点击会触发 "Blocked script execution" 告警**（父页面在该文档上执行的回调被拦）。补 `allow-scripts` 后错误归零。渲染产物只含 div/style/svg，由本工具生成，无外部脚本注入风险。
2. **短号语义**：会话级、不落盘。同一 nodeId 重复点击复用原短号（不重复分配）；`#N` 全局递增，跨项目不冲突。
3. **面包屑**：从命中的 DOM 元素逐层 `closest` 向上收集祖先链，无需后端参与。
4. **嵌入模式**：`embed=1` 时渲染页不自刷新，热重载由父页面 SSE 驱动；直接访问时仍注入自刷新脚本。

## 过程中修正

1. `Mark` / `MarkInput` 在服务端与前端各写一份被静态检查拦下——抽出 `src/shared/api-types.ts`，两侧 `import type`，前端 tsconfig `include` 增加 `../src/shared`。
2. `let cur: Element | null` + `cur.closest(...)` 触发 TS 循环推断（返回值类型依赖 `cur` 自身）——给中间结果显式注解 `Element | null` 打断循环。
3. 测试侧：`idle 自动退出` 用例会重启 daemon（端口变化），导致后续 marks 用例 `ECONNREFUSED`——重启后同步更新 `baseUrl`，marks 用例自行确保项目已注册。

## 证据（2026-11-10）

```text
pnpm exec tsc --noEmit   → root 与 ui 双端 0 错误
pnpm test                → 8 文件 105 用例全过（新增 marks API 7 项）
pnpm build               → ui 21.57 kB JS / 3.88 kB CSS

浏览器实测（Playwright + 系统 Chrome）：
  依次点击 title / card / star
  → 标记 ["#1 Title","#2 Card","#3 Star"]
  → 面包屑 ["App","Star"]
  → iframe 内 [data-ptr-selected] = 1
  → 控制台错误 0
```

## 未完成（留给后续）

- **变更高亮**：AI 写操作后把受影响节点圈出来（需要写工具回传 changed ids 并推送前端）
- **嵌套层级切换**：目前面包屑可点击跳转，但「点选父级」的修饰键交互未做
