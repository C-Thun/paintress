import { z } from 'zod';
import { BoolOrVar, ColorOrVar, CornerRadius, NumOrVar, Padding, Sizing, StringOrVar } from './scalars.js';
import { CrossAxis, MainAxis, LayoutDir, PositionMode } from './enums.js';
import { GraphicsBlock } from './styles.js';

/** 规格来源：format/spec.yaml §node_base、§layout_block、§nodes（v0.2.0） */

/** 节点公共基座。id 必填且禁含 '/'（保留给 ref 后代路径）。 */
export const NodeBase = {
  id: z.string().regex(/^[^/]+$/, 'id 禁止包含 / （保留给 ref 后代路径）'),
  name: z.string().optional(),
  context: z.string().optional(),
  reusable: z.boolean().optional(),
  theme: z.record(z.string()).optional(),
  enabled: BoolOrVar.optional(),
  opacity: NumOrVar.optional(),
  flipX: BoolOrVar.optional(),
  flipY: BoolOrVar.optional(),
  layoutPosition: PositionMode.optional(),
  metadata: z.object({ type: z.string() }).passthrough().optional(),
  rotation: NumOrVar.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: Sizing.optional(),
  height: Sizing.optional(),
};

/** 布局块（容器持有）。规格默认：layout=horizontal、gap=0、justify/align=start。 */
export const LayoutBlock = {
  layout: LayoutDir.optional(),
  gap: NumOrVar.optional(),
  padding: Padding.optional(),
  justifyContent: MainAxis.optional(),
  alignItems: CrossAxis.optional(),
  layoutIncludeStroke: z.boolean().optional(),
};

const sizeBlock = {
  width: Sizing.optional(),
  height: Sizing.optional(),
};

export const FrameSchema = z
  .object({
    type: z.literal('frame'),
    ...NodeBase,
    ...LayoutBlock,
    ...GraphicsBlock,
    clip: BoolOrVar.optional(),
    placeholder: z.boolean().optional(),
    slot: z.union([z.literal(false), z.array(z.string())]).optional(),
    cornerRadius: CornerRadius.optional(),
    children: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const GroupSchema = z
  .object({
    type: z.literal('group'),
    ...NodeBase,
    effect: z.unknown().optional(),
    children: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const RectangleSchema = z
  .object({
    type: z.literal('rectangle'),
    ...NodeBase,
    ...sizeBlock,
    ...GraphicsBlock,
    cornerRadius: CornerRadius.optional(),
  })
  .passthrough();

export const EllipseSchema = z
  .object({
    type: z.literal('ellipse'),
    ...NodeBase,
    ...sizeBlock,
    ...GraphicsBlock,
    innerRadius: NumOrVar.optional(),
    startAngle: NumOrVar.optional(),
    sweepAngle: NumOrVar.optional(),
  })
  .passthrough();

export const PolygonSchema = z
  .object({
    type: z.literal('polygon'),
    ...NodeBase,
    ...sizeBlock,
    ...GraphicsBlock,
    polygonCount: NumOrVar.optional(),
    cornerRadius: NumOrVar.optional(),
  })
  .passthrough();

export const PathSchema = z
  .object({
    type: z.literal('path'),
    ...NodeBase,
    ...sizeBlock,
    ...GraphicsBlock,
    geometry: z.string().optional(),
    fillRule: z.enum(['nonzero', 'evenodd']).optional(),
    viewBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  })
  .passthrough();

export const TextSchema = z
  .object({
    type: z.literal('text'),
    ...NodeBase,
    ...sizeBlock,
    ...GraphicsBlock,
    content: StringOrVar.optional(),
    textGrowth: z.enum(['auto', 'fixed-width', 'fixed-width-height']).optional(),
    fontFamily: StringOrVar.optional(),
    fontSize: NumOrVar.optional(),
    fontWeight: StringOrVar.optional(),
    letterSpacing: NumOrVar.optional(),
    fontStyle: StringOrVar.optional(),
    underline: BoolOrVar.optional(),
    lineHeight: NumOrVar.optional(),
    textAlign: z.enum(['left', 'center', 'right', 'justify']).optional(),
    textAlignVertical: z.enum(['top', 'middle', 'bottom']).optional(),
    strikethrough: BoolOrVar.optional(),
    href: z.string().optional(),
  })
  .passthrough();

export const NoteSchema = z
  .object({
    type: z.literal('note'),
    ...NodeBase,
    ...sizeBlock,
    content: StringOrVar.optional(),
    color: ColorOrVar.optional(),
  })
  .passthrough();

export const IconSchema = z
  .object({
    type: z.literal('icon'),
    ...NodeBase,
    ...sizeBlock,
    library: z.string().optional(),
    icon: StringOrVar.optional(),
    weight: NumOrVar.optional(),
    fill: z.unknown().optional(),
  })
  .passthrough();

export const ScriptSchema = z
  .object({
    type: z.literal('script'),
    ...NodeBase,
    ...sizeBlock,
    scriptUri: z.string().optional(),
    inputs: z.record(z.union([z.string(), z.number(), z.boolean(), z.string().regex(/^\$.+/)])).optional(),
    clip: BoolOrVar.optional(),
  })
  .passthrough();

export const BrowserSchema = z
  .object({
    type: z.literal('browser'),
    ...NodeBase,
    ...sizeBlock,
    url: z.string().optional(),
    deviceId: z.string().optional(),
    zoom: z.number().optional(),
    scrollX: z.number().optional(),
    scrollY: z.number().optional(),
    cornerRadius: CornerRadius.optional(),
    effect: z.unknown().optional(),
    stroke: z.unknown().optional(),
    strokeWidth: z.unknown().optional(),
    strokeLinecap: z.unknown().optional(),
    strokeLinejoin: z.unknown().optional(),
    strokeAlignment: z.unknown().optional(),
  })
  .passthrough();

/** ref：组件实例。ref 上直接出现的其他属性 = 对组件根的覆写（passthrough 承载）。 */
export const RefSchema = z
  .object({
    type: z.literal('ref'),
    ...NodeBase,
    ref: z.string(),
    descendants: z.record(z.unknown()).optional(),
  })
  .passthrough();

/** 已知节点类型清单（与 format/spec.yaml §nodes 的键一一对应） */
export const KNOWN_NODE_TYPES = [
  'frame', 'group', 'rectangle', 'ellipse', 'polygon', 'path',
  'text', 'note', 'icon', 'script', 'browser', 'ref',
] as const;

export type KnownNodeType = (typeof KNOWN_NODE_TYPES)[number];

/** 完整节点 union：已知 12 种 + 未知兜底。 */
export const UnknownNodeSchema = z
  .object({ type: z.string(), id: z.string().optional() })
  .passthrough();

export const NodeSchema = z.union([
  FrameSchema, GroupSchema, RectangleSchema, EllipseSchema, PolygonSchema,
  PathSchema, TextSchema, NoteSchema, IconSchema, ScriptSchema, BrowserSchema,
  RefSchema, UnknownNodeSchema,
]);

/** 已知类型 → 专属 schema；未知类型 → 宽松兑底（保留透传语义）。 */
const SCHEMA_BY_TYPE: Record<string, z.ZodTypeAny> = {
  frame: FrameSchema,
  group: GroupSchema,
  rectangle: RectangleSchema,
  ellipse: EllipseSchema,
  polygon: PolygonSchema,
  path: PathSchema,
  text: TextSchema,
  note: NoteSchema,
  icon: IconSchema,
  script: ScriptSchema,
  browser: BrowserSchema,
  ref: RefSchema,
};

/** 插入/写入用：已知类型走严格校验，未知类型走宽松兑底。 */
export function schemaForType(type: string): z.ZodTypeAny {
  return SCHEMA_BY_TYPE[type] ?? UnknownNodeSchema;
}

export type PenNode = z.infer<typeof NodeSchema>;
