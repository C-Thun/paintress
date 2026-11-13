import type { VarResolver, Warnings } from './vars.js';
import {
  fillsToCss, strokeToCss, effectsToCss, textToCss, commonToCss, cornerRadiusToCss,
  type CSSDecl,
} from './style.js';
import { getLucideIcon, resolveIconName } from './icons.js';
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
    // spec: alignItems 默认 start；CSS 默认 stretch 会把子节点拉满交叉轴，必须显式覆盖
    const ai = node['alignItems'];
    if (ai === 'start') decls.push(['align-items', 'flex-start']);
    else if (ai === 'center' || ai === 'end') decls.push(['align-items', ai === 'end' ? 'flex-end' : 'center']);
    else decls.push(['align-items', 'flex-start']);
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
  // 节点可以锁主题（`theme: {mode, density}`）：沿子树覆盖，变量取对应主题项
  const scoped = isRecord(node['theme']) ? vars.withTheme(node['theme']) : vars;
  // spec: enabled 默认 true，false = 显隐（设计稿里常用作「开关式」隐藏辅助层）
  if (scoped.resolveBool(node['enabled'] as boolean | string) === false) return '';
  const label = typeof node['name'] === 'string' && node['name'] !== '' ? `${type}: ${String(node['name'])}` : type;
  const positioned = parentLayout === 'none' || node['layoutPosition'] === 'absolute';

  if (type === 'script' || type === 'browser' || !KNOWN_RENDER_TYPES.has(type)) {
    return openTag(node, '', extraAttrs) + placeholderBox(label, []) + '</div>';
  }

  const css: CSSDecl[] = [];
  if (positioned) {
    css.push(['position', 'absolute']);
    const x = numericSize(node['x'], scoped);
    const y = numericSize(node['y'], scoped);
    css.push(['left', `${x ?? 0}px`], ['top', `${y ?? 0}px`]);
  } else {
    // 非绝对定位节点也要成为 containing block：否则子节点的 layoutPosition=absolute
    // 会越过它，锚到最近的祖先（画板），坐标语义整个错位
    css.push(['position', 'relative']);
  }
  const { decls: layoutCss, effective } = layoutDecls(node, scoped);
  css.push(...layoutCss);
  // spec：布局子节点保持自身量出尺寸，不参与收缩（CSS 默认 flex-shrink:1 会把文字压成竖排）
  if (parentLayout !== 'none' && !positioned) css.push(['flex-shrink', '0']);
  css.push(...sizeDecls(node['width'], node['height'], positioned, parentLayout, scoped, warnings, label));
  css.push(...commonToCss(node, scoped));

  // 文本节点：fill 即字色（textToCss 内处理），不再走 fillsToCss
  if (type !== 'text') css.push(...fillsToCss(node['fill'], scoped, warnings, label));
  css.push(...strokeToCss(node, scoped, warnings, label));
  css.push(...effectsToCss(node['effect'], scoped, warnings, label));

  let inner = '';
  switch (type) {
    case 'text': {
      css.push(...textToCss(node, scoped, warnings));
      const content = typeof node['content'] === 'string' ? scoped.resolve(node['content']) : '';
      inner = escapeHtml(content);
      break;
    }
    case 'icon':
    case 'icon_font': {
      const colorCss = fillsToCss(node['fill'], scoped, warnings, label).find(([p]) => p === 'background-color');
      if (colorCss) css.push(['color', colorCss[1]], ['background', 'transparent']);
      // icon_font 是上游工具的写法（iconFontName / iconFontFamily），与 icon 语义等价
      const fontVariant = type === 'icon_font';
      const libField = fontVariant ? node['iconFontFamily'] : node['library'];
      const nameField = fontVariant ? node['iconFontName'] : node['icon'];
      const lib = typeof libField === 'string' && libField !== '' ? libField : 'lucide';
      const iconName = typeof nameField === 'string' ? scoped.resolve(nameField) : '';
      // 非 lucide 库先做别名映射（Material Symbols → lucide）：
      // 形状略有出入也好过整块虚线占位框——界面里的关键操作图标不该全是空框
      const lucideName = resolveIconName(lib, iconName);
      const svg = iconName === '' ? null : getLucideIcon(lucideName, warnings);
      if (svg === null && lucideName === iconName && lib !== 'lucide' && lib !== 'feather') {
        warnings.push(`${label}: 图标库 "${lib}" 的 "${iconName}" 没有可用的 lucide 等价图标，渲染为占位框`);
      }
      inner = svg
        ? svg.replace('<svg', '<svg style="width:100%;height:100%;display:block"')
        : placeholderBox(`${lib}:${iconName}`, []);
      break;
    }
    case 'note': {
      const color = fillsToCss(node['fill'] ?? node['color'] ?? '#FEE484', scoped, warnings, label);
      const bg = color.find(([p]) => p === 'background-color')?.[1] ?? '#FEE484';
      css.push(['background', bg], ['padding', '8px 10px'], ['color', '#292524'], ['font', '12px/1.5 system-ui,sans-serif'], ['border-radius', '4px'], ['overflow', 'hidden']);
      const content = typeof node['content'] === 'string' ? scoped.resolve(node['content']) : '';
      inner = escapeHtml(content);
      break;
    }
    case 'ellipse': {
      css.push(['border-radius', '50%']);
      const inner2 = scoped.resolveNum(node['innerRadius'] as number | string);
      if (inner2 !== undefined && inner2 > 0) warnings.push(`${label}: innerRadius 环形暂按实心椭圆渲染`);
      const sweep = scoped.resolveNum(node['sweepAngle'] as number | string);
      if (sweep !== undefined && sweep !== 360) warnings.push(`${label}: 弧形（sweepAngle=${sweep}）暂按整圆渲染`);
      break;
    }
    case 'polygon': {
      const count = scoped.resolveNum(node['polygonCount'] as number | string);
      const n = count ?? 3;
      if (count === undefined) warnings.push(`${label}: polygonCount 缺省按 3 渲染`);
      if (node['cornerRadius'] !== undefined) warnings.push(`${label}: 多边形圆角暂忽略`);
      css.push(['clip-path', polygonClip(n)]);
      break;
    }
    case 'path': {
      css.push(...cornerRadiusToCss(node['cornerRadius'], scoped));
      const d = typeof node['geometry'] === 'string' ? node['geometry'] : '';
      const color = fillsToCss(node['fill'], scoped, warnings, label).find(([p]) => p === 'background-color')?.[1] ?? '#000000';
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
      css.push(...cornerRadiusToCss(node['cornerRadius'], scoped));
      if (type === 'group' && node['effect'] !== undefined) {
        // group 无 fill/stroke，仅效果（spec CanHaveEffects）
      }
      break;
    }
  }

  const kidsRaw = node['children'];
  const childrenHtml = Array.isArray(kidsRaw)
    ? kidsRaw.filter(isRecord).map((k) => renderNode(k, effective, scoped, warnings)).join('')
    : '';

  const cssStr = css.map(([p, v]) => `${p}:${v}`).join(';');
  return openTag(node, cssStr, extraAttrs) + inner + childrenHtml + '</div>';
}

const KNOWN_RENDER_TYPES = new Set(['frame', 'group', 'rectangle', 'ellipse', 'polygon', 'path', 'text', 'note', 'icon', 'icon_font', 'script', 'browser']);

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

/** 画板包围盒（顶层节点）：供「只截某个画板」选择与裁剪使用 */
export interface BoardBox {
  id: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boardBoxes(nodes: PenNode[], vars: VarResolver): BoardBox[] {
  const out: BoardBox[] = [];
  for (const n of nodes) {
    if (!isRecord(n)) continue;
    const box = nodeBox(n, vars);
    const name = typeof n['name'] === 'string' && n['name'] !== '' ? n['name'] : undefined;
    out.push({
      id: typeof n['id'] === 'string' ? n['id'] : '',
      ...(name !== undefined ? { name } : {}),
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
    });
  }
  return out;
}

/** 渲染整棵（已展开的）树：顶层节点在画布上绝对定位，并带画布元数据 */
export function renderTree(nodes: PenNode[], vars: VarResolver, warnings: Warnings): string {
  return nodes
    .filter(isRecord)
    .map((n) => {
      // 画板几何也要按它自己的主题算（light/loose 板子的坐标可能引用主题变量）
      const scoped = isRecord(n['theme']) ? vars.withTheme(n['theme']) : vars;
      return renderNode(n, 'none', vars, warnings, boardAttrs(n, scoped));
    })
    .join('');
}
