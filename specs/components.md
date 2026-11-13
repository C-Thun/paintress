# 项目级组件库（`__components.ptr` + 只读画廊）

## 需求

项目里已做好的组件要能被「看见」并复用，避免重复造轮子。

- 项目根下 `__components.ptr`，`watch` 时不存在就自动创建。
- 查看器里**只读**：点工具条「组件」→ 浮出面板，把所有组件以**固定尺寸正方形 tile** 展示，名称在下方，用来判断 agent 做到哪了。
- agent 侧：作画前先查组件库，能复用就**复制**（operator 2026-11-13 定：先复制插入，不做统一编辑，也不做真 ref）；新建可复用组件后登记进组件库。
- 提示词注入（SKILL.md + MCP instructions）必须包含「先查组件再动手，禁止重复造轮子」。

## 数据模型

`__components.ptr` 是普通设计稿，组件就是 `reusable: true` 的节点（pen 原生语义）：

```json
{ "version": "2.22", "fileToken": "<uuid>", "variables": {},
  "children": [ { "type": "frame", "id": "cmp-btn-primary", "name": "Button / Primary",
                  "reusable": true, "width": 120, "height": 40 } ],
  "x-paintress": { "spec": "1", "components": { "version": 1 } } }
```

- 画廊扫描**全树** `reusable: true`（不只顶层），名称取 `name ?? id`。
- 组件可使用项目预设（`$color-*`），渲染/取尺寸时按预设合并后的副本计算。

## 接口与工具

- `GET /api/components?project=` → `{ ok, path, items: [{ id, name, type, width, height }] }`（尺寸来自渲染包围盒）
- `GET /render-component?project=<name>&id=<nodeId>` → 单组件渲染 HTML（透明底、无画布边距），供 tile 的 iframe 使用
- `paintress_component { action: list|insert, path?, id?, parent?, index? }`
  - `list`：读组件库（不依赖 daemon）
  - `insert`：把组件**复制**进目标设计稿：先 `expandRefs` 展开内部 ref 使复制件自包含，再为整棵子树**重排 id**（`collectIds` + `genId`），最后校验落盘

## 不做

- 跨文件真 `ref`（`imports` 的 id 语法在规格里仍是 TBD）
- 组件的统一编辑 / 变体 / 参数（operator：现在主要靠 agent 维护，UI 只读）

## 验收

1. 注册项目 → 自动出现 `__components.ptr`；空库时画廊有空态。
2. 画廊 tile 数 = 组件库里 `reusable` 节点数，名称与文件一致，tile 内缩放不变形。
3. `insert` 后目标文件无重复 id、能独立渲染（不依赖组件库）。
4. 组件里的内部 ref 在复制件里已展开（不出现「ref 指向不存在」警告）。
5. `__preset.ptr` / `__components.ptr` 不出现在侧栏设计稿列表里。
