import { makeVarResolver, expandRefs, type Warnings } from './index.js';
import { renderTree, computeCanvas, escapeAttr } from './html.js';
import type { PenDocument } from '../schema/index.js';

export interface RenderResult {
  html: string;
  warnings: Warnings;
  /** 画布尺寸（顶层节点包围盒，px） */
  canvas: { width: number; height: number };
}

export interface RenderOptions {
  /** 页面标题（默认 paintress render） */
  title?: string;
}

/**
 * 渲染入口（决策 2/3/4/5 的兑现）：
 * 变量内联解析 → ref 展开 → 树 → HTML（每节点 data-node-id）。
 * 纯函数：不改文档；文件系统仅图标读取（见 render/icons.ts）。
 */
export function renderDocument(doc: PenDocument, opts: RenderOptions = {}): RenderResult {
  const warnings: Warnings = [];
  const vars = makeVarResolver(doc, warnings);
  const expanded = expandRefs(doc, warnings);
  const canvas = computeCanvas(expanded, vars);
  const title = opts.title ?? 'paintress render';
  const body = renderTree(expanded, vars, warnings);
  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeAttr(title)}</title>`,
    '<style>',
    '* { box-sizing: border-box; margin: 0; padding: 0; }',
    'body { margin: 0; background: #ffffff; }',
    '.ptr-canvas { position: relative; }',
    '</style>',
    '</head>',
    '<body>',
    `<div class="ptr-canvas" style="width:${canvas.width}px;height:${canvas.height}px">`,
    body,
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
  return { html, warnings, canvas };
}
