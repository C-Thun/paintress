import { z } from 'zod';
import { ColorOrVar, NumOrVar, BoolOrVar, Affine } from './scalars.js';
import { BlendMode, GradientType, ImageFit, StrokeAlign, StrokeCap, StrokeJoin, ShadowKind } from './enums.js';

/** 规格来源：format/spec.yaml §styles（v0.2.0）
 *  所有对象均 passthrough：未知键透传保留，绝不丢数据。 */

const fillCommon = {
  enabled: BoolOrVar.optional(),
  blendMode: BlendMode.optional(),
  opacity: NumOrVar.optional(),
};

export const SolidFill = z
  .object({ type: z.literal('color'), color: ColorOrVar, ...fillCommon })
  .passthrough();

export const GradientFill = z
  .object({
    type: z.literal('gradient'),
    gradientType: GradientType.optional(),
    center: z.object({ x: NumOrVar, y: NumOrVar }).passthrough().optional(),
    size: z.object({ width: NumOrVar, height: NumOrVar }).passthrough().optional(),
    rotation: NumOrVar.optional(),
    colors: z
      .array(z.object({ color: ColorOrVar, position: NumOrVar }).passthrough())
      .optional(),
    ...fillCommon,
  })
  .passthrough();

export const ImageFill = z
  .object({
    type: z.literal('image'),
    url: z.string().optional(),
    mode: ImageFit.optional(),
    transform: Affine.optional(),
    ...fillCommon,
  })
  .passthrough();

export const ShaderFill = z
  .object({
    type: z.literal('shader'),
    url: z.string(),
    uniforms: z.record(z.union([z.number(), z.boolean(), z.string(), z.array(z.number())])).optional(),
    ...fillCommon,
  })
  .passthrough();

export const MeshGradientFill = z
  .object({
    type: z.literal('mesh_gradient'),
    columns: z.number().optional(),
    rows: z.number().optional(),
    colors: z.array(ColorOrVar).optional(),
    points: z.array(z.unknown()).optional(),
    ...fillCommon,
  })
  .passthrough();

/** 单个填充项：颜色字符串（含 $变量）或结构化填充对象 */
export const FillEntry = z.union([
  ColorOrVar,
  SolidFill,
  GradientFill,
  ImageFill,
  ShaderFill,
  MeshGradientFill,
]);

/** fill 字段：单项或数组（按序叠放，后画在前） */
export const Fills = z.union([FillEntry, z.array(FillEntry)]);

export const StrokeWidth = z.union([
  NumOrVar,
  z.object({ top: NumOrVar.optional(), right: NumOrVar.optional(), bottom: NumOrVar.optional(), left: NumOrVar.optional() }).passthrough(),
]);

export const StrokeBlock = {
  stroke: Fills.optional(),
  strokeWidth: StrokeWidth.optional(),
  strokeLinecap: StrokeCap.optional(),
  strokeLinejoin: StrokeJoin.optional(),
  strokeAlignment: StrokeAlign.optional(),
};

export const BlurEffect = z.object({ type: z.literal('blur'), radius: NumOrVar.optional(), enabled: BoolOrVar.optional() }).passthrough();

export const BackgroundBlurEffect = z.object({ type: z.literal('background_blur'), radius: NumOrVar.optional(), enabled: BoolOrVar.optional() }).passthrough();

export const ShadowEffect = z
  .object({
    type: z.literal('shadow'),
    shadowType: ShadowKind.optional(),
    offset: z.object({ x: NumOrVar, y: NumOrVar }).passthrough().optional(),
    blur: NumOrVar.optional(),
    color: ColorOrVar.optional(),
    blendMode: BlendMode.optional(),
    enabled: BoolOrVar.optional(),
  })
  .passthrough();

export const ShaderEffect = z
  .object({
    type: z.literal('shader'),
    url: z.string(),
    uniforms: z.record(z.unknown()).optional(),
    enabled: BoolOrVar.optional(),
  })
  .passthrough();

export const EffectEntry = z.union([BlurEffect, BackgroundBlurEffect, ShadowEffect, ShaderEffect]);
export const Effects = z.union([EffectEntry, z.array(EffectEntry)]);

export const GraphicsBlock = {
  fill: Fills.optional(),
  ...StrokeBlock,
  effect: Effects.optional(),
};
