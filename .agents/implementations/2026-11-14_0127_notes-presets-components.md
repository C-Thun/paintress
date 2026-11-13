# 2026-11-14T01:27+08:00 — Notes drawer, project presets and a read-only component gallery in the viewer

**1. 设计稿笔记（`specs/notes-drawer.md`）**
- `GET /api/notes?project&path`：只认「设计稿同目录、同名 `.md`」，`safeJoin` 防穿越，512KB 上限（超出 413）。
- `/events` 同时监听设计稿、同名笔记、项目预设文件；`watchers.acquire` 补 `add` 事件，笔记从无到有也能推。
- UI：画布行重构为 `.canvas-row`（笔记抽屉占布局，固定 380px）+ `.canvas-wrap`（iframe 与浮动控件）。抽屉打开时左上角按钮消失；`Esc` 关闭。
- Markdown 用 **marked**（+14.9KB gzip，0 依赖），**懒加载**成独立 chunk（构建产物 `marked.esm-*.js` 49.18 kB），原样 HTML 转义、链接只放行 http(s)/mailto/#。

**2. 项目预设（`specs/project-presets.md`）**
- 项目根 `__preset.ptr`（`watch` 时不存在就建）：值走原生 `variables`，类型/名称走 `x-paintress.presets`；颜色存 string、倒角存 number。
- `src/doc/project.ts`：项目根发现、读写、`applyProjectPresets`（渲染/截图/校验/写前检查共用，永远返回副本）。
- **保存永远写未合并的原文档**——`paintress_update` 不会把预设值烤进设计稿（有回归测试）。
- 校验：预设变量算已定义；本地同名变量覆盖时给警告（在原始文档上判断，不在合并副本上）。
- 工具 `paintress_preset`（list/set/remove）、CLI `paintress preset ...`、daemon `GET/PUT /api/presets`（写要 `x-paintress` 头，mtime 乐观并发）。
- UI：`preset-panel.tsx` 分组编辑（色板 + 文本 / 数字），改值 → PUT → 立即重渲染。

**3. 组件库（`specs/components.md`）**
- 项目根 `__components.ptr`，组件是 `reusable: true` 节点；`listDesigns` 隐藏 `__*`（侧栏与文件数不被污染）。
- 工具 `paintress_component`（list/insert）：insert 先 `expandRefs` 展开内部 ref，再整棵子树重排 id，复制件自包含；`reusable` 标记被去掉（复制出来的是实例）。
- daemon `GET /api/components`（尺寸用渲染包围盒）+ `/render-component`（透明底单节点）。
- UI：`component-gallery.tsx` 固定 148px 正方形 tile + 名称，iframe 等比缩放。

## 界面结构（新建组件已报备）

新增 5 个组件 + 1 个模块：`panel.tsx`（三处共用的面板壳）、`tool-rail.tsx`、`notes-drawer.tsx`、`preset-panel.tsx`、`component-gallery.tsx`、`markdown.ts`。
复用：`Modal`/`Confirm`、`.ghost/.tiny`、`.lang-switch` 样式、侧栏列表样式；图标内联 SVG，不新增图标库。

## 文档与记忆

- README 双语重写「这是什么」：不再从「读写结构化设计文档」开头，改成普通开发/使用者能看懂的三段；`.ptr` 从用户文档里拿掉，只在文档区留一句「已有的 `.pen` 也能直接打开」。
- `SKILL.md`：新增「Design system: presets and components」硬规则（先定预设、先查组件、禁止重复造轮子）+ 工具表两行。
- `format/spec.yaml`：ptr 扩展补 `x-paintress.presets` / `x-paintress.components`。
- `server.json`（MCP Registry）+ `verify:pkg` 校验其版本与 package.json 一致。
- `FUTURE.md`：删掉过期的 trusted publishing 条目（`publish.yml` 无 token、0.5.2 带 SLSA 证明），层二/画谱改成「已提前落地 + 指针」。

## 证据

- `pnpm check`（server）与 `pnpm --dir ui typecheck` 0 错误；`pnpm test` **22 文件 286 用例全绿**；`pnpm build` 通过（ui 主包 58.16 kB / 20.25 gzip，marked 独立 chunk）；`verify:pkg` 通过。
- 新增测试：`project-presets.spec.ts`(10)、`components.spec.ts`(5)、`notes-api.spec.ts`(12)、`ui-interaction.spec.ts`(2，真实 Chromium：抽屉收窄画布 380+gap、图标消失、预设改值落盘、组件 tile、Esc 收起)。
- 端到端 CLI：`preset set` → `update` 用 `$color-brand` → `render` 输出 `background-color:#3B82F6` → `validate` 0 警告 → 设计稿 `variables` 仍为空。
- 提交：`5c89729`。
