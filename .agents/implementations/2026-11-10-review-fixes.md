# 评审修复与建议项收口（2026-11-10）

- 范围：阶段 4 两轮代码评审中确认的问题 + 4 条建议项的成本收益评估结论。
- 提交：`d43241d`（评审修复）、`0a22eed`（建议项收口）。

## 评审确认并修复的问题

| 位置 | 问题 | 修法 |
| --- | --- | --- |
| `src/mcp/tools.ts` `notifyChanges` | 变更通知传相对路径，daemon 按自己的 cwd `resolve`，跨 cwd 时匹配失败、高亮静默丢失 | 通知前 `resolve(path)` 转绝对路径 |
| `src/web/daemon.ts` `changes` case | 多项目根互相包含时按注册顺序先匹配，会记到外层项目 | 按 `rootReal` 长度降序取最深根 |
| `src/web/daemon.ts` 越界判断 | 可能误伤 `..foo` 这类合法目录名 | 改为排除 `..` 与 `../`、`..\` 前缀 |
| `src/web/daemon.ts` | `ChangesStore.prune()` 无人调用 | 接入 idle 检查定时器（每次 tick 执行） |

## 建议项评估与处置

| # | 建议 | 成本 | 收益 | 处置 |
| --- | --- | --- | --- | --- |
| 1 | 前端 30s 阈值 vs 后端 TTL 60s 不一致 | 5 分钟 | 中 | ✅ 删除前端阈值，过期判定统一由 daemon 负责（原逻辑会把 30–60s 仍有效的变更丢掉） |
| 2 | batch 的 insert 新节点 id 未回传 | 20 分钟 | 中 | ✅ 执行前后对比 id 集合求差集，返回值增加 `inserted` 计数 |
| 3 | prune 依赖 idle 定时器，可能频率低 | — | 零 | ❌ **撤销建议**：核实后 `prune()` 在 `if (idleSince…)` 之外，每次 tick（默认 15s）都执行，与 idle 状态无关。原建议基于错误描述 |
| 4 | `notifyChanges` 非阻塞可能丢通知 | 10 分钟 | 极低 | ❌ 不做：Node socket 持 ref，事件循环不会在响应前退出；本地 UDS 往返 <1ms。改 `await` 会把写路径拖慢最多 2s，不划算 |

## 测试增量

- `test/changes.spec.ts`（新增 8 用例）：socket→HTTP 链路、项目外路径忽略、嵌套项目最深根、合并窗口、TTL 过期、prune、batch 新 id 回传、update 只记录目标 id。

## 证据

- `tsc --noEmit`：root + ui 双端 0 错误
- `pnpm test`：9 文件 **117 用例全绿**
- 端到端实测：绝对路径与「子目录 cwd + 相对路径」两种写法都能正确记录 `title`
