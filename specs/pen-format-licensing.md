# 调研：解析 `.pen` 格式的版权风险

> **内部合规记录，不对外发布。** `README.md` 与面向用户的文档不引用本文内容，也不提及任何第三方产品。

- 状态：已完成（2026-11-10）
- 问题：paintress 读取、解析、改写 `.pen` 文件，并独立实现渲染器，是否存在版权风险？
- 结论：**风险低**。核心依据是文件格式属功能性设计、官方文档明确面向「读写 .pen 的开发者」、EULA 约束的是软件而非用户自己的文件。但有 3 条红线必须守住，见 §风险清单。

> 本文是工程侧的风险梳理，**不构成法律意见**。涉及商业化或收到侵权主张时，应交由执业律师判断。

## 一、法律依据

### 1. 文件格式本身不受著作权保护

- 中国《计算机软件保护条例》（2013 修订）第六条：「本条例对软件著作权的保护**不延及开发软件所用的思想、处理过程、操作方法或者数学概念等**。」
- 欧盟 CJEU `SAS Institute v. WPL`（C-406/10）：编程语言与**数据文件的格式**本身不属于著作权保护的表达。
- 美国 `Sega v. Accolade`（9th Cir. 1992）：为实现互操作性而研究他人软件的**功能性要素**，构成合理使用。
- 字段名（`frame` / `text` / `fill` / `layout`）是功能性标识，属于「合并原则」（merger doctrine）——实现该功能只有这一种表达方式，不受保护。

### 2. 官方文档明确授权「读写」用途

`.pen` 格式文档首段原文：

> "This documentation is for developers who would like to **read or write .pen files**."

并且官方在该页公开完整的 TypeScript schema，作为「authoritative, exhaustive reference」。这直接否定了「只能通过官方工具处理文件」的主张。

### 3. EULA 管的是软件，不是文件

- 限制条款针对的对象是 **the software**：「Copy, modify, or redistribute **pen.dev**」「Reverse-engineer or decompile **the software**」。解析一个 JSON 数据文件不是对软件的反编译。
- 所有权条款明确把文件交给用户：「You retain ownership of any content you create or submit through pen.dev (\"Inputs\")」「you own the AI-generated outputs produced for you (\"Outputs\")」。
- EULA 是用户与 High Agency, Inc. 之间的合同，**paintress 不是当事方**；用户处置自己拥有所有权的文件，是行使所有权。
- 管辖：特拉华州法（§11），不是中国法。但这也意味着实际诉讼门槛与成本都很高。

### 4. 同类实现大量存在且长期存活

- `fig-kiwi`（npm）：读写 Figma `.fig` 格式。
- `figma-kiwi-protocol`：读写 Figma 文件并提供 MCP server。
- `figmatojson`：将 `.fig` 转为 `.pen` 与 HTML。
- `hermes-pen-bridge`：第三方 MCP bridge，并明确标注 "Not affiliated with or endorsed by High Agency, Inc. 'Pencil' is their trademark; this project uses the name descriptively only."

格式逆向与互操作实现在业界是常态，未见针对此类工具的著作权主张。

## 二、风险清单

### 红线 1 — 不复制文档与 schema 原文

schema 的 **TypeScript 定义文本**属于「表达」，受著作权保护。参照其字段语义自行实现属合法；整段拷贝文档原文进本仓库则可能侵权。

**做法**：类型定义自己写；注释描述语义，不复述官方文档措辞；需要引用时只引极短片段并注明出处。

### 红线 2 — EULA 的「竞争服务」条款

原文（§3）：

> "you must not use the Software or outputs to develop, train, or improve any model or service that competes with ours"

**判定不触发**：paintress 不安装、不调用该软件，不读取其输出用于模型训练，也不训练任何模型。用户的设计稿属 user-owned Inputs/Outputs（§4），交给其他工具处理是行使所有权。

**做法**：README 与文档中明确「不使用对方软件、不做模型训练」，避免被解释为「以对方输出开发竞争服务」。

### 红线 3 — 商标

「Pencil」「pen.dev」是对方商标。产品名不得使用，不得暗示隶属或背书。

**做法**：品牌名 `paintress` 已避开；描述性提及格式时加免责声明（参照 `hermes-pen-bridge` 的写法）。

### 次要风险（非版权）

- **schema 不兼容变更**：官方明确保留随时改格式的权利（"we reserve the right to introduce breaking changes"）。属技术风险，处置方式为版本探测 + 迁移脚本。
- **专利**：本次检索未发现 High Agency, Inc. 名下与设计文件格式相关的授权专利或公开申请。**该检索非穷尽**，不能作为「无专利风险」的保证；商业化前应做专业 FTO 检索。

## 三、行动项

| 项 | 说明 | 状态 |
| --- | --- | --- |
| README 免责声明 | 声明非官方、不隶属、不使用对方软件、不做模型训练 | 未做 |
| 类型定义独立撰写 | 不拷贝官方 schema 文本 | 待实施时遵守 |
| 保留独立实现证据 | git 历史完整，便于证明独立开发 | 已具备 |
| 专业 FTO 检索 | 仅在商业化时考虑 | 未触发 |

## 四、证据来源

- `https://www.pen.dev/eula`（生效 2026-10-15，读取于 2026-11-10）
- `https://docs.pencil.dev/for-developers/the-pen-format`（读取于 2026-11-10）
- 《计算机软件保护条例》（国务院令第 632 号，2013 修订）第六条、第十七条
- `Sega Enterprises Ltd. v. Accolade, Inc.`, 977 F.2d 1510 (9th Cir. 1992)
- `Google LLC v. Oracle America, Inc.`, 141 S. Ct. 1163 (2021)（假定可版权、认定合理使用，未就可版权性表态）
- `SAS Institute Inc. v. World Programming Ltd.`, CJEU C-406/10
