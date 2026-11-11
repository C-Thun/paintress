# 品牌、双语 README 与发布工作流（2026-11-11）

- 范围：logo 矢量化、查看器配色、双语 README + 给 AI 的安装手册、随包 skill、CI/发布工作流。
- 决策输入：operator 定「两色（logo 主蓝 + 1964 深金）」「图形与字标分离」「描摹后简化」「UI 只换主色与强调色」「随包附 skill」。

## 1. Logo 矢量化

源图 `~/repos/tmp/selected.png`（1254×1254，米白底），产物 `assets/logo.svg`（562×884，2 个 path，11.8 KB）。

流水线（一次性脚本，未入仓）：

1. **分段**：与背景色 `#FAF4EF` 的曼哈顿距离 > 60 判为墨迹；按行剖面找到「图形 / 字标」之间的空隙（y≈995），裁掉字标。
2. **两色分类**：k-means（k=4）给出主蓝 `#043376`(189k)、浅蓝 `#759BD6`(15k)、中蓝 `#5780BD`(11k)、暗蓝 `#022A6B`(5k)。取 `lum > 100 && B > R + 15` 为「高光 → 金」，其余为「主色 → 蓝」。
3. **去噪**：连通域 < 200px 丢弃；高度 ≤3px 且宽高比 >15 的细条丢弃（抗锯齿在画笔箍附近造成的假高光）。
4. **描摹**：`vtracer`（venv 安装，无需 root）二值模式 + spline + `filter_speckle`/`length_threshold` 控制简化。
5. **合成**：填洞求外轮廓 + 单独描摹内部空洞，两段 `d` 拼进同一个 `<path fill-rule="evenodd">`，得到「实心轮廓 + 镂空」的单个 path。

**踩过的两个坑**（下次直接抄结论）：

- **极性**：vtracer 二值模式把**深色**当前景。蒙版必须存成「形状=黑、背景=白」，否则描出来的是整块画布。
- **层次**：`hierarchical='stacked'` 会把孔洞输出成独立 path，需要按层次交替填色；直接用 `evenodd` 合并会丢内容。可靠做法是自己填洞（flood fill 求外部），把「外轮廓 + 空洞」拼接成一个 path。

校验：把 SVG 用 headless Chromium 渲染回 562×884，与原图裁剪同尺寸比对——整体像素一致率 **96.7%**，轮廓 IoU **92.8%**，白色背景 IoU **98.2%**。金色 IoU 只有 51%，因为源图高光是渐变、二值化后必然略厚（有意为之，小尺寸更清楚）。

## 2. 两色体系

| 用途 | 颜色 |
| --- | --- |
| 主色 / 文字 / 激活态 | `#254E8A`（logo 蓝） |
| 强调 / 画布内选中 | `#97885F`（1964 金，Tokyo 1964 官方图稿矢量取样值） |
| 提醒 / 变更脉冲 | `#C9A227`（同色相提亮，保证在浅底上可见） |

- 查看器：`--accent` 由 `#2563eb` 改为 `#254E8A`，`--accent-soft` 改为 `#e9eef7`；iframe 内选中/悬停/变更脉冲改走金色系（原为蓝色/琥珀）。
- 侧栏标题旁嵌入 `ui/public/logo.svg`（Vite 会复制进 `ui/dist`，daemon 直接托管，实测 `GET /logo.svg → 200`）。

## 3. 文档与 skill

- `README.md`（英文主文件）+ `README.zh-CN.md`（中文，顶部互链）。开头只有一句安装提示：把仓库地址贴给 agent。
- 文末「Installation guide for AI agents」：**先检测后安装**——`command -v paintress` / `npm ls -g` / `paintress doctor`，任一命中即复用；多 agent 场景下每个 agent 只写自己的配置条目；`install` 幂等（`noop`），改动前备份；附验证（initialize 握手）与卸载步骤。
- `skills/paintress/SKILL.md`：工具清单、`#N` 标记语义、编辑前先查询、批量后校验等约定；`package.json#files` 增加 `skills` 与 `assets`，随包发布。

## 4. CI 与发布工作流

| 文件 | 内容 |
| --- | --- |
| `.github/workflows/ci.yml` | push/PR：pnpm 安装 → 装 Chromium（截图测试需要）→ typecheck → test → build |
| `.github/workflows/publish.yml` | `v*` tag 或手动：install → test → build → `verify:pkg` → `npm publish --provenance`（OIDC，无 token） |

两个 workfl 的 action 全部钉到 commit SHA（`checkout`/`pnpm-action-setup`/`setup-node`），`checkout` 带 `persist-credentials: false`。

## 证据（2026-11-11）

```text
pnpm check / test / build     → 0 错误；11 文件 161 用例全绿；ui 28.83 kB
pnpm verify:pkg               → 通过（新增 assets/logo.svg、skills/paintress/SKILL.md 两项检查）
查看器实测                     → 侧栏 logo 200、active 态为 #254e8a、画布选中为金色、控制台 0 错误
logo 校验                      → 一致率 96.7% / 轮廓 IoU 92.8%（562×884 同尺寸渲染比对）
```

## 未做

- npm 侧的 trusted publisher 尚未配置（需要 owner 在包设置里绑定仓库与工作流），配置后 `publish.yml` 才可跑。
- 未发新版本；README/logo/skill 的变更等下次发布带上。
