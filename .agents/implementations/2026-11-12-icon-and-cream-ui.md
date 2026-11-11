# README 图标（WebP）与米白底界面（2026-11-12）

- 输入：operator 定稿 logo（`assets/logo.svg`，蓝 `#205080` / 金 `#908030`）+ 要求「用 selected 的浅色底、圆角矩形、512×512、喜欢 selected 的字标字体」。

## 产物

| 文件 | 内容 |
| --- | --- |
| `assets/icon-512-wordmark.webp` | 512×512 圆角矩形（半径 110）+ 米白底 `#FAF4EF` + logo + 字标；README 头部用它 |
| `assets/icon-512.webp` | 同上但纯图形（无字标），可作应用图标 |

生成方式：headless Chromium 以 `deviceScaleFactor: 2` 渲染 512×512（`omitBackground` 保留圆角外透明），Pillow 缩到 512 并存 **无损 WebP**（17.4 KB / 22.3 KB）。字标用 Poppins SemiBold 600（OFL，Fontsource 的 woff2，仅渲染时使用，未入仓）——与 `selected` 的字标字形一致（几何无衬线、单层 a、圆形 e）。

**踩坑**：ImageMagick 的 `convert` 在本机 WebP 委托上挂死（8 分钟无输出），改用 Pillow 秒级完成；项目里以后做位图转换直接用 Pillow。

## 界面配色（米白底）

- 令牌：`--bg: #f6f1ea`（取自 logo 底 `#FAF4EF` 略压暗）、`--panel: #fffcf8`、`--border: #e6ded2`、`--muted: #7a7166`；主色/金色沿用定稿两色。
- 画布改为「浮在米白底上」：`.stage` 用米白，`.preview` 加 12px 外边距、10px 圆角、1px 边框与两层柔和阴影。
- 结果：面板（暖白）与画布（白）之间有了层次，画布不再是全屏白块。

## 证据

```text
pnpm check / test / build   → 0 错误；11 文件 161 用例全绿；ui 28.86 kB
pnpm verify:pkg             → 通过（新增 assets/icon-512-wordmark.webp 检查）
查看器实测                   → --bg #f6f1ea、logo 200、选中金色、控制台 0 错误
图标                        → 512×512 无损 WebP，圆角外透明
```
