# 项目级预设（`__preset.ptr`）

## 需求

把「颜色 / 倒角」这类会反复微调的值抽成**项目级预设**：agent 作画前先把它们定下来注册，设计稿里只写引用；
人在查看器里直接调预设值看实时效果，不用一句句跟 agent 说「红一点、再蓝一点」。

- 预设 = `type + key + value`（+ 可选名称）。一期类型：`color`（颜色）、`radius`（倒角）。
- 项目级：项目根下 `__preset.ptr`，`watch`（注册项目）时不存在就自动创建。
- 设计稿用 pen 原生 `$key` 引用；值只在预设文件里存一份。
- 人可在查看器的预设面板里改值 → 画布实时更新。

## 数据模型

`__preset.ptr`：值走原生 `variables`（文件本身是合法 pen 文档），类型/名称走 `x-paintress.presets`：

```json
{ "version": "2.22", "fileToken": "<uuid>",
  "variables": { "color-brand-500": { "type": "color", "value": "#3B82F6" },
                 "radius-md": { "type": "number", "value": 6 } },
  "children": [],
  "x-paintress": { "spec": "1",
    "presets": { "version": 1,
      "items": { "color-brand-500": { "type": "color", "name": "主色" },
                 "radius-md": { "type": "radius", "name": "圆角中" } } } } }
```

- 对外 API 的值一律字串；落盘按变量真实类型（color→string，radius→number，否则渲染器 `resolveNum` 会告警）。
- `radius` 与普通 number 靠 `x-paintress.presets.items[key].type` 区分；缺 metadata 时按变量类型回退（color→color，number→radius）。

## 解析规则

- **项目根**：从设计稿所在目录向上找最近的含 `__preset.ptr` / `__components.ptr` 的目录。
- **合并**：渲染 / 校验用副本 `{...doc, variables: {...预设, ...文档本地}}`——本地优先；本地覆盖同名预设时校验给警告（不静默漂移）。
- **保存永远写未合并的原文档**：绝不能因为一次 `paintress_update` 把预设值烤进设计稿（专门回归测试）。
- 没有预设文件的项目：行为完全不变。

## 接口与工具

- `GET /api/presets?project=` → `{ ok, path, items }`（未建文件时 items 为空）
- `PUT /api/presets`（要 `x-paintress` 头）`{ project, key, value, type?, name? }` → 写文件并返回最新 items；`mtime` 乐观并发保护
- `paintress_preset { action: list|set|remove, path?, key?, type?, name?, value? }`（MCP 与 CLI 共用，不依赖 daemon）

## 验收

1. 注册新项目 → 自动出现 `__preset.ptr`（已存在则不动，`createOnly`）。
2. `$color-brand-500` 在设计稿里解析成预设值；本地同名变量覆盖并给警告。
3. 面板改色 → 画布立即变；改完的设计稿里**没有**被烤进去的预设变量。
4. `paintress_preset set` 的非法类型/值被拒（color 只认 `#RGB|#RRGGBB|#RRGGBBAA`，radius 只认非负数）。
5. 预设文件被 Pencil 打开是合法文档（只有变量、没有画布内容）。
