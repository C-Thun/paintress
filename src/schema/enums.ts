import { z } from 'zod';

/** 规格来源：format/spec.yaml §enums（v0.2.0，enum_ref 的目标全部在此定义） */

export const LayoutDir = z.enum(['none', 'vertical', 'horizontal']);
export const MainAxis = z.enum(['start', 'center', 'end', 'space_between', 'space_around']);
export const CrossAxis = z.enum(['start', 'center', 'end']);
export const BlendMode = z.enum([
  'normal', 'darken', 'multiply', 'linearBurn', 'colorBurn', 'light',
  'screen', 'linearDodge', 'colorDodge', 'overlay', 'softLight', 'hardLight',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);
export const GradientType = z.enum(['linear', 'radial', 'angular']);
export const ImageFit = z.enum(['cover', 'contain', 'stretch']);
export const FillRule = z.enum(['nonzero', 'evenodd']);
export const StrokeCap = z.enum(['butt', 'round', 'square']);
export const StrokeJoin = z.enum(['miter', 'bevel', 'round']);
export const StrokeAlign = z.enum(['inner', 'center', 'outer']);
export const TextAlign = z.enum(['left', 'center', 'right', 'justify']);
export const TextAlignVertical = z.enum(['top', 'middle', 'bottom']);
export const TextGrowth = z.enum(['auto', 'fixed-width', 'fixed-width-height']);
export const ShadowKind = z.enum(['inner', 'outer']);
export const IconLibrary = z.enum([
  'lucide', 'feather',
  'Material Symbols Outlined', 'Material Symbols Rounded', 'Material Symbols Sharp',
  'phosphor',
]);
export const PositionMode = z.enum(['auto', 'absolute']);
