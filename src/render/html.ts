import type { VarResolver, Warnings } from './vars.js';
import {
  fillsToCss, strokeToCss, effectsToCss, textToCss, commonToCss, cornerRadiusToCss,
  type CSSDecl,
} from './style.js';
import { getLucideIcon } from './icons.js';
import type { PenNode } from '../schema/index.js';

/**
 * 树 → HTML。每个节点输出 data-node-id / data-node-type / data-node-name（决策 2）。
 * 布局语义（specs/technical-plan.md 决策 2）：
 * - 父 layout=none（或根画布）→ 子节点 absolute 定位
 * - 父 layout=vertical/horizontal → flex 流；子 fill_container 主轴 flex:1、交叉轴 stretch
 * - 绝对定位下 fit_content → max-content，fill_container → 回退值或 100%
 */

type AnyNode = Record<string, unknown>;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 'fit_content(120)' → 120（sizing 字符串内的回退值） */
function sizingFallback(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const m = /^(?:fit_content|fill_container)\((\d+(?:\.\d+)?)\)$/.exec(raw);
  return m ? Number(m[1]) : undefined;
}

function numericSize(raw: unknown, vars: VarResolver): number | undefined {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && raw.startsWith('$')) return vars.resolveNum(raw);
  return undefined;
}

interface NodeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 节点几何盒：数值尺寸 → sizing 回退值 → 0（与 computeCanvas 同规则） */
function nodeBox(node: AnyNode, vars: VarResolver): NodeBox {
  return {
    x: numericSize(node['x'], vars) ?? 0,
    y: numericSize(node['y'], vars) ?? 0,
    w: numericSize(node['width'], vars) ?? sizingFallback(node['width']) ?? 0,
    h: numericSize(node['height'], vars) ?? sizingFallback(node['height']) ?? 0,
  };
}

/** 属性数值：整数不带小数，其余最多 3 位（避免浮点噪声进 HTML） */
function numStr(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

/** 尺寸映射。axis 仅在 flex 父内有意义（main/cross），绝对定位下两轴同规则 */
function sizeDecls(
  rawW: unknown, rawH: unknown,
  positioned: boolean, parentLayout: 'none' | 'horizontal' | 'vertical',
  vars: VarResolver, warnings: Warnings, what: string,
): CSSDecl[] {
  const decls: CSSDecl[] = [];
  const axis = (raw: unknown, isMain: boolean, prop: string): void => {
    if (raw === undefined) return;
    if (typeof raw === 'number' || (typeof raw === 'string' && raw.startsWith('$'))) {
      const n = numericSize(raw, vars);
      if (n !== undefined) decls.push([prop, `${n}px`]);
      return;
    }
    if (typeof raw !== 'string') return;
    if (raw === 'fit_content') {
      if (positioned) decls.push([prop, 'max-content']);
      return; // flex 流内 = auto
    }
    if (raw.startsWith('fit_content')) {
      const fb = sizingFallback(raw);
      if (positioned) decls.push([prop, fb !== undefined ? `${fb}px` : 'max-content']);
      return;
    }
    if (raw.startsWith('fill_container')) {
      if (positioned) {
        const fb = sizingFallback(raw);
        if (fb !== undefined) decls.push([prop, `${fb}px`]);
        else {
          decls.push([prop, '100%']);
          warnings.push(`${what}: 绝对定位下的 fill_container 无回退值，按 100% 渲染`);
        }
      } else if (isMain) {
        decls.push(['flex', '1 1 0%']);
      } else {
        decls.push(['align-self', 'stretch']);
      }
    }
  };
  const wIsMain = parentLayout === 'horizontal';
  axis(rawW, wIsMain, 'width');
  axis(rawH, !wIsMain, 'height');
  return decls;
}

function layoutDecls(node: AnyNode, vars: VarResolver): { decls: CSSDecl[]; effective: 'none' | 'horizontal' | 'vertical' } {
  const type = node['type'];
  const rawLayout = node['layout'];
  let effective: 'none' | 'horizontal' | 'vertical';
  if (rawLayout === 'vertical' || rawLayout === 'horizontal' || rawLayout === 'none') {
    effective = rawLayout;
  } else {
    effective = type === 'frame' ? 'horizontal' : 'none'; // spec：frame 默认 horizontal；group 无布局块
  }
  const decls: CSSDecl[] = [];
  if (effective === 'vertical' || effective === 'horizontal') {
    decls.push(['display', 'flex']);
    decls.push(['flex-direction', effective === 'vertical' ? 'column' : 'row']);
    const gap = vars.resolveNum(node['gap'] as number | string);
    if (gap !== undefined && gap !== 0) decls.push(['gap', `${gap}px`]);
    const p = node['padding'];
    if (typeof p === 'number' || typeof p === 'string') {
      const n = vars.resolveNum(p);
      if (n !== undefined) decls.push(['padding', `${n}px`]);
    } else if (Array.isArray(p)) {
      const nums = p.map((v) => vars.resolveNum(v as number | string));
      if (nums.every((n) => n !== undefined)) decls.push(['padding', nums.map((n) => `${n}px`).join(' ')]);
    }
    const jc = node['justifyContent'];
    if (jc === 'start' || jc === 'center' || jc === 'end') decls.push(['justify-content', jc]);
    else if (jc === 'space_between') decls.push(['justify-content', 'space-between']);
    else if (jc === 'space_around') decls.push(['justify-content', 'space-around']);
    const ai = node['alignItems'];
    if (ai === 'start' || ai === 'center' || ai === 'end') decls.push(['align-items', ai]);
  }
  return { decls, effective };
}

function placeholderBox(label: string, extra: CSSDecl[]): string {
  const css = [
    'border:1px dashed #94a3b8',
    'background:#f1f5f9',
    'color:#64748b',
    'font:11px/1.4 system-ui,sans-serif',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'overflow:hidden',
    'white-space:nowrap',
    'text-overflow:ellipsis',
    ...extra.map(([p, v]) => `${p}:${v}`),
  ].join(';');
  return `<div style="${css}">${escapeHtml(label)}</div>`;
}

function polygonClip(count: number): string {
  const n = Math.max(3, Math.round(count));
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (-90 + (360 / n) * i) * (Math.PI / 180);
    const x = 50 + 50 * Math.cos(a);
    const y = 50 + 50 * Math.sin(a);
    pts.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
  }
  return `polygon(${pts.join(', ')})`;
}

function openTag(node: AnyNode, css: string, extraAttrs: readonly string[] = []): string {
  const id = typeof node['id'] === 'string' ? node['id'] : '';
  const type = typeof node['type'] === 'string' ? node['type'] : '?';
  const name = typeof node['name'] === 'string' ? node['name'] : '';
  const attrs = [
    `data-node-id="${escapeAttr(id)}"`,
    `data-node-type="${escapeAttr(type)}"`,
    ...(name ? [`data-node-name="${escapeAttr(name)}"`] : []),
    ...extraAttrs,
  ];
  return `<div ${attrs.join(' ')}${css ? ` style="${escapeAttr(css)}"` : ''}>`;
}

/** 顶层节点的画布元数据（specs/canvas-interaction.md §2.2） */
function boardAttrs(node: AnyNode, vars: VarResolver): string[] {
  const box = nodeBox(node, vars);
  const name = typeof node['name'] === 'string' ? node['name'] : '';
  return [
    'data-board="1"',
    ...(name ? [`data-board-name="${escapeAttr(name)}"`] : []),
    `data-board-x="${numStr(box.x)}"`,
    `data-board-y="${numStr(box.y)}"`,
    `data-board-w="${numStr(box.w)}"`,
    `data-board-h="${numStr(box.h)}"`,
  ];
}

function renderNode(
  node: AnyNode,
  parentLayout: 'none' | 'horizontal' | 'vertical',
  vars: VarResolver,
  warnings: Warnings,
  extraAttrs: readonly string[] = [],
): string {
  const type = String(node['type'] ?? '?');
  const label = typeof node['name'] === 'string' && node['name'] !== '' ? `${type}: ${String(node['name'])}` : type;
  const positioned = parentLayout === 'none' || node['layoutPosition'] === 'absolute';

  if (type === 'script' || type === 'browser' || !KNOWN_RENDER_TYPES.has(type)) {
    return openTag(node, '', extraAttrs) + placeholderBox(label, []) + '</div>';
  }

  const css: CSSDecl[] = [];
  if (positioned) {
    css.push(['position', 'absolute']);
    const x = numericSize(node['x'], vars);
    const y = numericSize(node['y'], vars);
    css.push(['left', `${x ?? 0}px`], ['top', `${y ?? 0}px`]);
  }
  const { decls: layoutCss, effective } = layoutDecls(node, vars);
  css.push(...layoutCss);
  css.push(...sizeDecls(node['width'], node['height'], positioned, parentLayout, vars, warnings, label));
  css.push(...commonToCss(node, vars));

  // 文本节点：fill 即字色（textToCss 内处理），不再走 fillsToCss
  if (type !== 'text') css.push(...fillsToCss(node['fill'], vars, warnings, label));
  css.push(...strokeToCss(node, vars, warnings, label));
  css.push(...effectsToCss(node['effect'], vars, warnings, label));

  let inner = '';
  switch (type) {
    case 'text': {
      css.push(...textToCss(node, vars, warnings));
      const content = typeof node['content'] === 'string' ? vars.resolve(node['content']) : '';
      inner = escapeHtml(content);
      break;
    }
    case 'icon': {
      const colorCss = fillsToCss(node['fill'], vars, warnings, label).find(([p]) => p === 'background-color');
      if (colorCss) css.push(['color', colorCss[1]], ['background', 'transparent']);
      const lib = typeof node['library'] === 'string' ? node['library'] : 'lucide';
      const iconName = typeof node['icon'] === 'string' ? node['icon'] : '';
      let svg: string | null = null;
      if (lib === 'lucide' || lib === 'feather') {
        svg = getLucideIcon(iconName, warnings);
      } else {
        warnings.push(`${label}: 图标库 "${lib}" 暂只支持 lucide/feather，渲染为占位框`);
      }
      inner = svg
        ? svg.replace('<svg', '<svg style="width:100%;height:100%;display:block"')
        : placeholderBox(`${lib}:${iconName}`, []);
      break;
    }
    case 'note': {
      const color = fillsToCss(node['fill'] ?? node['color'] ?? '#FEE484', vars, warnings, label);
      const bg = color.find(([p]) => p === 'background-color')?.[1] ?? '#FEE484';
      css.push(['background', bg], ['padding', '8px 10px'], ['color', '#292524'], ['font', '12px/1.5 system-ui,sans-serif'], ['border-radius', '4px'], ['overflow', 'hidden']);
      const content = typeof node['content'] === 'string' ? vars.resolve(node['content']) : '';
      inner = escapeHtml(content);
      break;
    }
    case 'ellipse': {
      css.push(['border-radius', '50%']);
      const inner2 = vars.resolveNum(node['innerRadius'] as number | string);
      if (inner2 !== undefined && inner2 > 0) warnings.push(`${label}: innerRadius 环形暂按实心椭圆渲染`);
      const sweep = vars.resolveNum(node['sweepAngle'] as number | string);
      if (sweep !== undefined && sweep !== 360) warnings.push(`${label}: 弧形（sweepAngle=${sweep}）暂按整圆渲染`);
      break;
    }
    case 'polygon': {
      const count = vars.resolveNum(node['polygonCount'] as number | string);
      const n = count ?? 3;
      if (count === undefined) warnings.push(`${label}: polygonCount 缺省按 3 渲染`);
      if (node['cornerRadius'] !== undefined) warnings.push(`${label}: 多边形圆角暂忽略`);
      css.push(['clip-path', polygonClip(n)]);
      break;
    }
    case 'path': {
      css.push(...cornerRadiusToCss(node['cornerRadius'], vars));
      const d = typeof node['geometry'] === 'string' ? node['geometry'] : '';
      const color = fillsToCss(node['fill'], vars, warnings, label).find(([p]) => p === 'background-color')?.[1] ?? '#000000';
      const vbRaw = node['viewBox'];
      const vb = Array.isArray(vbRaw) && vbRaw.length === 4 && vbRaw.every((v) => typeof v === 'number') ? (vbRaw as number[]) : [0, 0, 100, 100];
      inner =
        `<svg viewBox="${vb.join(' ')}" width="100%" height="100%" preserveAspectRatio="none">` +
        `<path d="${escapeAttr(d)}" fill="${escapeAttr(color)}" fill-rule="${node['fillRule'] === 'evenodd' ? 'evenodd' : 'nonzero'}"/></svg>`;
      break;
    }
    case 'frame':
    case 'group':
    case 'rectangle':
    default: {
      css.push(...cornerRadiusToCss(node['cornerRadius'], vars));
      if (type === 'group' && node['effect'] !== undefined) {
        // group 无 fill/stroke，仅效果（spec CanHaveEffects）
      }
      break;
    }
  }

  const kidsRaw = node['children'];
  const childrenHtml = Array.isArray(kidsRaw)
    ? kidsRaw.filter(isRecord).map((k) => renderNode(k, effective, vars, warnings)).join('')
    : '';

  const cssStr = css.map(([p, v]) => `${p}:${v}`).join(';');
  return openTag(node, cssStr, extraAttrs) + inner + childrenHtml + '</div>';
}

const KNOWN_RENDER_TYPES = new Set(['frame', 'group', 'rectangle', 'ellipse', 'polygon', 'path', 'text', 'note', 'icon', 'script', 'browser']);

/** 顶层包围盒（数值尺寸参与计算；sizing 回退值兜底；缺省按 0 贡献） */
export function computeCanvas(nodes: PenNode[], vars: VarResolver): { width: number; height: number } {
  let maxW = 0;
  let maxH = 0;
  for (const n of nodes) {
    if (!isRecord(n)) continue;
    const box = nodeBox(n, vars);
    maxW = Math.max(maxW, box.x + box.w);
    maxH = Math.max(maxH, box.y + box.h);
  }
  return { width: Math.max(1, Math.ceil(maxW)), height: Math.max(1, Math.ceil(maxH)) };
}

/** 渲染整棵（已展开的）树：顶层节点在画布上绝对定位，并带画布元数据 */
export function renderTree(nodes: PenNode[], vars: VarResolver, warnings: Warnings): string {
  return nodes.filter(isRecord).map((n) => renderNode(n, 'none', vars, warnings, boardAttrs(n, vars))).join('');
}
