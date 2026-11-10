import { z } from 'zod';

/** 规格来源：format/spec.yaml §scalars（线键名，v0.2.0） */

/** 变量名形如 $accent、$gap-md（必须字母或下划线开头，避免把 $99 这类价格文本当成变量） */
export const VARIABLE_NAME = /^\$[A-Za-z_][A-Za-z0-9_-]*$/;

/** $name 变量引用 */
export const VariableRef = z.string().regex(VARIABLE_NAME);

export const NumOrVar = z.union([z.number(), VariableRef]);
export const Color = z.string();
export const ColorOrVar = z.union([Color, VariableRef]);
export const BoolOrVar = z.union([z.boolean(), VariableRef]);
export const StringOrVar = z.union([z.string(), VariableRef]);

/** 尺寸行为字：fit_content / fill_container，可带括号回退值 */
const SizingBehavior = z
  .string()
  .regex(/^(fit_content|fill_container)(\(\d+(\.\d+)?\))?$/);

export const Sizing = z.union([NumOrVar, SizingBehavior]);

/** 仿射矩阵 [a,b,c,d,tx,ty] */
export const Affine = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);

/** 内边距：全边 | [纵,横] | [上,右,下,左] */
export const Padding = z.union([
  NumOrVar,
  z.tuple([NumOrVar, NumOrVar]),
  z.tuple([NumOrVar, NumOrVar, NumOrVar, NumOrVar]),
]);

/** 圆角：均匀 | 四元组（角顺序 unverified，见 spec known_gaps） */
export const CornerRadius = z.union([
  NumOrVar,
  z.tuple([NumOrVar, NumOrVar, NumOrVar, NumOrVar]),
]);

export type VariableRef = z.infer<typeof VariableRef>;
export type NumOrVar = z.infer<typeof NumOrVar>;
export type ColorOrVar = z.infer<typeof ColorOrVar>;
export type Sizing = z.infer<typeof Sizing>;
export type Padding = z.infer<typeof Padding>;
export type CornerRadius = z.infer<typeof CornerRadius>;
