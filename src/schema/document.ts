import { z } from 'zod';
import { NodeSchema } from './nodes.js';

/** 规格来源：format/spec.yaml §document、§ptr（v0.2.0） */

const variableValueLiteral = z.union([z.string(), z.number(), z.boolean()]);

const themedValue = z
  .object({ value: variableValueLiteral, theme: z.record(z.string()).optional() })
  .passthrough();

/** 变量定义：type + value（字面量或按主题分派的列表） */
export const VariableDef = z
  .object({
    type: z.enum(['boolean', 'color', 'number', 'string']),
    value: z.union([variableValueLiteral, z.array(themedValue)]),
  })
  .passthrough();

/** ptr 文档级扩展（x-paintress）。pen 读取器忽略；ptr 写入器必须输出 spec 字段。 */
export const XPaintress = z
  .object({
    spec: z.string(),
    generator: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

export const X_PAINTRESS_KEY = 'x-paintress';
export const PTR_SPEC_VERSION = '1';

/**
 * 新文档写入的 `version` 字段值。
 * 必须与 `format/spec.yaml§meta.layers.pen_profile.observed_document_version` 同步
 * （`test/spec-conformance.spec.ts` 会断言两者相等）。
 */
export const PEN_DOC_VERSION = '2.22';

/** 文档根。passthrough：fileToken 与未来未知顶层键全部透传。 */
export const DocumentObjectSchema = z
  .object({
    version: z.string(),
    fileToken: z.string().optional(),
    themes: z.record(z.array(z.string())).optional(),
    imports: z.record(z.string()).optional(),
    variables: z.record(VariableDef).optional(),
    children: z.array(NodeSchema),
  })
  .passthrough();

export const DocumentSchema = DocumentObjectSchema.superRefine((doc, ctx) => {
    if (X_PAINTRESS_KEY in doc) {
      const parsed = XPaintress.safeParse((doc as Record<string, unknown>)[X_PAINTRESS_KEY]);
      if (!parsed.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [X_PAINTRESS_KEY], message: 'x-paintress 结构不合法' });
      }
    }
  });

export type PenDocument = z.infer<typeof DocumentSchema>;

/** .ptr 文档：pen_profile + x-paintress 必填 */
export const PtrDocumentSchema = DocumentSchema.and(
  z.object({ [X_PAINTRESS_KEY]: XPaintress }).passthrough(),
);

export type PtrDocument = z.infer<typeof PtrDocumentSchema>;
