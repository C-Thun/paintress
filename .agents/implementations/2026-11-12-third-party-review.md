# 2026-11-12 — 第三方评审修复：新建、目录监听与滑块

## 范围

只评审本日会话产生的变更：`icon_font` 兼容、查看器品牌/背景/语言、`paintress_new`、项目列表实时刷新及对应 FUTURE 计划。未改全局安装，未发版。

## 确认并修复

1. **目录监听范围过大**：`daemon.ts` 原本用 `fs.watch(root, {recursive:true})`，任意源码/构建文件变化都会推注册表事件，也扩大 inotify 占用。
   - 复用 `WatchManager`，新增按项目扫描深度、隐藏/构建目录和 `.ptr/.pen` 扩展名过滤的 chokidar 目录监听。
   - 目录与文件的深度边界分开计算（depth=1 允许 `nested/x.ptr`，不允许进入 `nested/deep/`）。
   - 普通文件与无关目录事件不再触发；shutdown/unwatch 清理仍由 WatchManager 统一负责。
2. **新建拒绝覆盖有跨进程竞争窗口**：`existsSync` 后直接 `renameSync`，两个进程可能都通过检查。
   - `saveDoc` 新增 `createOnly`，用同目录临时文件 + `linkSync` 原子创建，EEXIST 拒绝，不 touch 空目标。
   - 两个并发 CLI 实测：一个退出 0、一个退出 1，目标文档可正常读取。
3. **`iconFontName` 声明为 string_or_var，但渲染未解析 `$name`**：图标名现在经过 `vars.resolve`，新增 `$glyph → check` 用例。
4. **滑块取消手势误提交**：`pointercancel` 原来复用 pointerup，会把取消位置的值提交；现取消/丢失捕获只复位拖动，不改当前档位。抽离坐标换算纯函数并补边界测试。
5. **新建文档边界**：MCP 接受 0/负尺寸，CLI 对非法 layout 静默回退；现两者都拒绝，0/负尺寸不落盘。
6. **测试与声明缺口**：补父目录不存在时创建、显式 `.pen` 不注入 ptr 扩展、`PEN_DOC_VERSION` 与 spec 一致性测试；CLI 用法列表补 `new`。
7. **文档事实修正**：`icon_font` 明确标为冻结 pen profile 的遗漏补全（真实旧稿已存在），避免与 D-006 混淆；变更高亮计划区分「DOM 高亮持续至刷新」与变更记录 60s TTL；版本提示不再写死当前版本。

## 未直接修复

- 新增滑块仍缺入库的浏览器端 pointer capture / 拖动回归；本轮有真实 Chromium 手工回归和纯函数测试。建议在既有查看器 e2e 骨架落地时补，避免为此引入第二套测试栈。
- `refreshRegistry()` 多次 SSE 事件可能并发拉取，尚未复现乱序结果；若真实出现，可给刷新加序号或 AbortController，只接收最后一次结果。

## 验证

- `pnpm check` + `pnpm --dir ui typecheck` 均通过；`pnpm build` 通过。
- 全量 196 测试通过（13 文件）。
- 真实 daemon + Chromium：新建文件自动选中、Dark 点击、取消拖动不误改、第二项目无需 F5 出现、iframe 背景生效、无 page error。
- 非本轮问题：tsdown 对 `define` 的既有警告、`test/changes.spec.ts` 已记录偶发时序问题；均未修改。
