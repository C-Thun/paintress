# Logo 定稿：selected2 矢量化 + operator 定色（2026-11-11）

- 背景：operator 判断 `selected2` 更简约，选它作正式 logo；此前基于 `selected` 的版本作废（`2026-11-11-brand-docs-skill.md` 记录的是当时状态）。
- 分工：我出单色矢量化 → operator 在 Inkscape 里改轮廓、加第二色并定色 → 我同步仓库。

## 产物

| 项 | 值 |
| --- | --- |
| 文件 | `assets/logo.svg`（Inkscape 保存，保留其元数据以便继续编辑） |
| 画布 | 540 × 942 |
| 结构 | 2 个 path：蓝 `#205080`（发丝 + 笔杆）、金 `#908030`（笔毛） |
| 体积 | 7.7 KB |
| 字标 | 无（由页面文本渲染） |

矢量化侧：单色描摹自 `selected2.png`（1254²，裁掉字标与米白底），填洞求外轮廓 + 单独描摹空洞，`evenodd` 合成单 path；与原图裁剪同尺寸比对形状 **IoU 97.6%**。

## 同步项

- `ui/public/logo.svg`：替换为定稿（Vite 复制进 `ui/dist`，daemon 托管）。
- 查看器令牌：`--accent: #205080`、`--gold: #908030`；`--accent-soft` 与 `--gold-soft` 用同色透明度派生。
- iframe 内高亮：选中 = 金实线、悬停 = 金虚线（55% 透明）、变更脉冲 = 金 ↔ 35% 透明。**不再使用琥珀色与提亮金**，保持两色体系。
- `assets/logo.svg` 就是 README 引用的那个文件，路径未变。

## 证据

```text
形状 IoU（矢量化版本 vs selected2 原图）  → 97.6%
pnpm test                                  → 11 文件 161 用例全绿
pnpm build / verify:pkg                    → 通过；ui/dist/logo.svg 随前端产物
查看器实测                                  → 侧栏 logo 200、激活态 #205080、画布选中金色、控制台 0 错误
```
