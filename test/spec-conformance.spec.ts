import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  KNOWN_NODE_TYPES,
  DocumentObjectSchema,
  FrameSchema,
  TextSchema,
  LayoutDir, MainAxis, CrossAxis, BlendMode, GradientType, ImageFit,
  FillRule, StrokeCap, StrokeJoin, StrokeAlign, TextAlign, TextAlignVertical,
  TextGrowth, ShadowKind, IconLibrary, PositionMode,
  X_PAINTRESS_KEY,
} from '../src/index.js';

/** 规格与实现的一致性：format/spec.yaml 是唯一事实来源，schema 必须与之一致 */

function rec(v: unknown, where: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`spec 结构异常：${where} 不是对象`);
  }
  return v as Record<string, unknown>;
}

const spec = rec(
  yaml.load(readFileSync(join(import.meta.dirname, '../format/spec.yaml'), 'utf8')),
  '<root>',
);

describe('spec conformance: 节点类型', () => {
  it('KNOWN_NODE_TYPES 与 spec.nodes 键一致', () => {
    const specNodes = Object.keys(rec(spec['nodes'], 'nodes')).sort();
    expect([...KNOWN_NODE_TYPES].sort()).toEqual(specNodes);
  });
});

describe('spec conformance: 枚举', () => {
  const enumMap: Record<string, { options: readonly string[] }> = {
    layout_dir: LayoutDir,
    main_axis: MainAxis,
    cross_axis: CrossAxis,
    blend_mode: BlendMode,
    gradient_type: GradientType,
    image_fit: ImageFit,
    fill_rule: FillRule,
    stroke_cap: StrokeCap,
    stroke_join: StrokeJoin,
    stroke_align: StrokeAlign,
    text_align: TextAlign,
    text_align_v: TextAlignVertical,
    text_growth: TextGrowth,
    shadow_kind: ShadowKind,
    icon_library: IconLibrary,
    position_mode: PositionMode,
  };

  it('spec.enums 的每个枚举与 zod enum 选项集合一致', () => {
    const specEnums = rec(spec['enums'], 'enums');
    for (const [name, schema] of Object.entries(enumMap)) {
      const values = specEnums[name];
      if (!Array.isArray(values)) throw new Error(`spec.enums.${name} 不是数组`);
      expect(new Set(schema.options), `枚举 ${name}`).toEqual(new Set(values as string[]));
    }
  });

  it('spec.enums 没有未被实现覆盖的枚举', () => {
    const specEnums = Object.keys(rec(spec['enums'], 'enums'));
    expect(Object.keys(enumMap).sort()).toEqual([...specEnums].sort());
  });
});

describe('spec conformance: 字段名', () => {
  it('node_base 的每个线键名都在 frame 与 text 的 shape 里', () => {
    const baseFields = Object.keys(rec(spec['node_base'], 'node_base'));
    const frameFields = Object.keys(FrameSchema.shape);
    const textFields = Object.keys(TextSchema.shape);
    for (const f of baseFields) {
      expect(frameFields, `frame 缺 ${f}`).toContain(f);
      expect(textFields, `text 缺 ${f}`).toContain(f);
    }
  });

  it('layout_block 的每个线键名都在 frame shape 里', () => {
    const layoutFields = Object.keys(rec(spec['layout_block'], 'layout_block'));
    const frameFields = Object.keys(FrameSchema.shape);
    for (const f of layoutFields) {
      expect(frameFields, `frame 缺 ${f}`).toContain(f);
    }
  });

  it('document.fields 的每个键都在文档 schema shape 里', () => {
    const docFields = Object.keys(rec(rec(spec['document'], 'document')['fields'], 'document.fields'));
    const shape = Object.keys(DocumentObjectSchema.shape);
    for (const f of docFields) {
      expect(shape, `文档缺 ${f}`).toContain(f);
    }
  });

  it('ptr 扩展键名一致', () => {
    const ptr = rec(spec['ptr'], 'ptr');
    const ext = rec(rec(ptr['document_extensions'], 'ptr.document_extensions')['x_paintress'], 'ptr.document_extensions.x_paintress');
    expect(ext['key']).toBe(X_PAINTRESS_KEY);
  });
});
