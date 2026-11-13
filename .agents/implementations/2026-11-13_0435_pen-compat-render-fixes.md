# 2026-11-13T04:35+08:00 — 修 5 类 .pen 解析/渲染偏差（绝对定位逃逸、flex 压缩、alignItems、文字垂直对齐、enabled 显隐）+ 项目名按目录展示

用 `c-thun/raybend/design/*.pen`（Pencil 产出的真实稿子）做兼容性对照时，发现查看器渲染与 Pencil 原义有系统性偏差。逐条核对 spec 后，确认 5 处属于「解析/渲染漏了语义」，属于确定性 bug，先修这一批。

## 修的东西（都在渲染层，除最后一条在 web 层）

1. **绝对定位子节点逃离父级**（影响最大）
   `layoutPosition: absolute` 的子节点只拿到 `position:absolute`，而父节点（flex 子项）保持 CSS 默认 `static`，于是锚点越过父级落到画板左上角。
   - 证据：`States / Export / 导出运行中` 里预设卡内的「流光带」被画到了画板顶部、压住「全部」标签（就是截图红箭头那处白渐变）。
   - 修法：非绝对定位节点也输出 `position:relative`（不改布局）。
   - 受影响节点数：browse.pen 235 / editor.pen 77 / export.pen 131。

2. **flex 子节点被 CSS 压缩**：spec 里唯一的伸展手段是 `fill_container`，子节点应保持量出尺寸；CSS 默认 `flex-shrink:1` 让文字被压成竖排（「总览/信息」渲染成 2×2 字）。改为布局子节点统一 `flex-shrink:0`；`fill_container` 的 `flex:1 1 0%` 仍在我们之后覆盖。

3. **alignItems 缺省值**：spec 默认 `start`，CSS 默认是 `stretch`。现在缺省显式输出 `align-items:flex-start`。

4. **textAlignVertical**：原来一律按 top 渲染并告警；现在 middle/bottom 用 column flex + justify-content 实现（editor 4 / export 10 个节点）。

5. **节点级 `enabled:false`**：spec 定义为显隐，渲染器完全没读，设计稿里用开关式隐藏的辅助层（editor 7 / export 44 / main 6 个，如 `ViewportNote`、`RatioLabel`、`Glyph / image`、整排 PresetCard）之前都被画了出来。现在整棵跳过。

6. **项目展示名**（web 层）：侧栏原来显示 `c-thun-raybend`（把 `/` 压成 `-` 的 URL 安全名）。新增 `deriveProjectLabel()`，展示用目录原样的 `c-thun/raybend`，URL / 协议仍用 `-` 形式。契约加 `ProjectInfo.label`（前端 `?? name` 回退，兼容旧 daemon）。

## 验证

- `pnpm check` 干净；`pnpm test` 238 passed（新增 5 条：containing block、flex-shrink、缺省 alignItems、enabled=false、deriveProjectLabel）。
- 真实稿子截图对照（`paintress shot --board`）：
  - `States / Editor / 裁切`：修前标题栏、ToolsBar、左侧 LUT 列表全部叠在左上角，文字竖排；修后回到各自位置，裁切网格落进视口。
  - `States / Export / 导出运行中`：修前「流光带」漂在画板顶部；修后回到预设卡内部，P0001–P0012 角标、进度条、右侧质量滑杆全部归位。
  - `Shell / Browse / Tiles`：结构正常（侧栏、星级/色标条、图块角标、右侧 EXIF）。

## 没修、留给后续（已列入报告）

主题/密度覆盖（`theme.mode`/`theme.density` 按节点继承）、Material Symbols 图标、`strokeAlignment: outer`、渐变 `size`/`center`、文本渐变填充、linear 渐变 rotation 的 0° 基准（0=上 vs 0=右，稿内两处证据互相矛盾）。
