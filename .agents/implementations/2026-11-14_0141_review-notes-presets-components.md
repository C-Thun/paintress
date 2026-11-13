# 2026-11-14T01:41+08:00 — Review fixes: strip reusable recursively, restrict note paths to design files

**① 已修：复制组件时只删了根节点的 `reusable`（src/mcp/tools.ts）**

`paintress_component insert` 先 `expandRefs` 再复制，但只在复制件根上 `delete copy['reusable']`。
组件库里的**嵌套组件**（ref 展开后仍带 `reusable: true`）被原样带进设计稿，
于是设计文件凭空多出一份组件定义，后续任何按 reusable 的查询都会被污染。
改为递归摘掉整棵子树的 `reusable`，并加回归测试。

**② 已修：`/api/notes` 的路径替换不校验扩展名（src/web/daemon.ts）**

原实现 `abs.replace(/\.(ptr|pen)$/i, '.md')` 对任何输入都执行：
请求 `design.md` 会去找 `design.md`（当成笔记再拼一次），请求无扩展名文件会拿无关文件名拼 `.md`。
新增 `notePathFor()`：只对真正的设计稿（`.ptr` / `.pen`）推导笔记路径，其余一律 404；补两条测试。

**③ 记录、未修（本轮范围外的既有实现）**
- `src/render/vars.ts`：`resolve()` 对变量值不做合法性校验。已通过 `normalizePresetValue` 守住 paintress 自己的预设写入路径；手改文件塞任意值仍会进 CSS（`style` 属性有 `escapeAttr` 兜底，不能直接逃逸），建议在渲染层对 `color_or_var` 加一道格式校验。
- `ui/src/App.tsx`：`loadPresets` / `loadComponents` 没有竞态保护，快速切项目时可能显示上一个项目的面板数据；`openProject` 时也应清空这两个 signal。
- `ui/src/preset-panel.tsx`：8 位带 alpha 的颜色（`#RRGGBBAA`）在色板里被截成 6 位，提交会丢 alpha。
- `src/doc/project.ts#listComponents`：复用 `readPresetFile` 只为拿 `doc`，语义混乱，应直接 `loadDoc`。
- `src/web/daemon.ts`：`/events` 只监听预设文件，不监听组件库文件，agent 新增组件时画廊不会自动刷新（SSE 已在监听 `.md` 与预设，补一个即可）。
- `ui/src/styles.css`：`.panel-float { right: 60px }` 与注释「工具条 44 + 空档 12」不一致（实际空档约 16px）。
- `src/mcp/tools.ts`：`paintress_preset remove` 的 `path` 返回值在文件不存在时为 null，语义可接受但前端没用到。

## 验证

- `pnpm check`（server）+ `pnpm --dir ui typecheck` 0 错误；**22 文件 288 用例全绿**（+2）；`pnpm build`、`verify:pkg` 通过。
- 安全复核：笔记 `innerHTML` 的 marked 策略实测干净（`<img onerror>`、`javascript:` 行内/引用式链接、`<svg><script>`、`<iframe srcdoc>` 全部转义或置空）。
- 提交：`18d6d54`。
