# 阶段 2：渲染器 + 截图（2026-11-10）

- 范围：`specs/technical-plan.md` 阶段 2 全部——`.pen` → HTML/CSS（带 `data-node-id`）+ headless 截图 PNG。
- 依赖新增：`lucide-static` 1.70.0（ISC，图标 SVG 数据）、`playwright-core`（Apache-2.0，不下载浏览器）。

## 变更清单

| 模块 | 文件 | 内容 |
| --- | --- | --- |
| 变量 | `src/render/vars.ts` | `$var` 解析；themed 列表取无主题项→首项；`resolveNum/Bool` 接受 `unknown`，非法/缺省→undefined+警告 |
| 展开 | `src/render/expand.ts` | ref 递归展开：ref 自身属性覆写组件根、descendants 路径（`a/b` 嵌套实例）浅合并/整体替换、环与悬空→紫色占位+警告；深克隆不改原文档 |
| 样式 | `src/render/style.ts` | fill 5 变体（mesh/shader 降级+警告）、stroke（多层取首层、四边宽度）、effect 4 变体、文本样式（fill=字色）、公共变换（rotation 逆时针→CSS 取负+origin 0 0、flip、clip）、cornerRadius |
| 布局 | `src/render/html.ts` | 父 none/absolute→绝对定位；flex 行列映射；尺寸行为字：fill 主轴 `flex:1 1 0%`/交叉轴 `stretch`、fit_content 绝对态 `max-content`/回退值；padding 1/2/4 值；justifyContent/alignItems；椭圆/多边形（clip-path）/路径（内嵌 SVG）/便签/占位框 |
| 入口 | `src/render/entry.ts` | `renderDocument()`：变量解析→ref 展开→树→HTML；画布=顶层包围盒 |
| 图标 | `src/render/icons.ts` | lucide-static 按需 fs 读（不进 bundle），camel→kebab，缺图标→占位+警告 |
| 截图 | `src/shot/screenshot.ts` | playwright-core + 浏览器探测（`PTR_BROWSER`→系统 chrome→ms-playwright 缓存）；默认 2x；临时 HTML 用后即删 |
| 工具 | `src/mcp/tools.ts` + `src/cli.ts` | `paintress_render`（HTML 文件）/ `paintress_screenshot`（PNG）；CLI `render <file> <out>` / `shot <file> <out> [--scale n]`；`run` 类型放宽支持 async |

## 过程中修正

1. **`resolveNum` 崩溃**：签名 `number | string` 但调用方普遍传可能 undefined 的 `node[key]`，`.startsWith` 直接炸——签名改 `unknown`，在源头统一防御。
2. **渐变角度负数**：`penAngleToCss` 少一次 `%`，deg>0 输出 `-90.0deg`——正确公式 `((360 - ((deg%360+360)%360)) % 360)`，加测试锁定（.pen 90°=左 → CSS 270deg）。
3. entry.ts 导入路径写错一层（`./render/index.js` 应为 `./index.js`），写 html.ts 时一并修正。
4. 工具层 async 化：`ToolDef.run` 允许 `Promise<ToolOutput>`，server 回调与 CLI `call()` 全链路 await。

## 证据

- `pnpm exec tsc --noEmit`：0 错误
- `pnpm test`：7 文件 73 用例全过（含真实浏览器截图：PNG 魔数、scale 对比）
- `pnpm build`：73.23 kB；CLI `render`/`shot` 直跑成功（浏览器 /usr/bin/google-chrome）
- 渲染保真度：视觉模型代看 /tmp/stage2.png 逐项验收（2026-11-10）：
  - 标题蓝色粗体、卡片 320x120 细边框圆角、五角星蓝色描边（lucide 本就是描边风格）、白色背景：均与预期一致；
  - 便签「检查布局」出现在星星下方左侧而非 x=640 处——**这是正确行为**：父 frame 开启 layout 时子节点 x/y 被忽略（spec 语义），入列流动；
  - 无重叠、无裁切、无错位。
  - 已知限制：未声明 fontFamily 的文本回退浏览器默认字体（渲染为衬线），属预期内降级。
