import type { VarResolver, Warnings } from './vars.js';

/**
 * 样式映射：fill / stroke / effect / 文本 / 公共变换 → CSS 声明。
 * 依据 specs/technical-plan.md 决策 2 的映射表。
 * 未映射的语义（shader、mesh_gradient、outer stroke、弧形等）降级 + 警告，不静默。
 */

export type CSSDecl = [prop: string, value: string];

type AnyNode = Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function colorFromFillEntry(entry: unknown, vars: VarResolver): string | undefined {
  if (typeof entry === 'string') return vars.resolve(entry);
  if (isRecord(entry)) {
    const c = entry['color'];
    if (typeof c === 'string') return vars.resolve(c);
  }
  return undefined;
}

function stopsToCssList(colors: unknown, vars: VarResolver): string | undefined {
  if (!Array.isArray(colors) || colors.length === 0) return undefined;
  const parts: string[] = [];
  for (const c of colors) {
    if (!isRecord(c)) continue;
    const col = colorFromFillEntry(c['color'], vars);
    const pos = vars.resolveNum(c['position'] as number | string);
    if (col === undefined) continue;
    parts.push(pos !== undefined ? `${col} ${(pos * 100).toFixed(2)}%` : col);
  }
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** .pen 逆时针度（0=上，90=左）→ CSS 角（0=上，顺时针正） */
function penAngleToCss(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  return `${((360 - normalized) % 360).toFixed(1)}deg`;
}

function normCenter(c: unknown): { x: string; y: string } {
  if (isRecord(c)) {
    const x = c['x'], y = c['y'];
    if (typeof x === 'number' && typeof y === 'number') {
      return { x: `${(x * 100).toFixed(2)}%`, y: `${(y * 100).toFixed(2)}%` };
    }
  }
  return { x: '50%', y: '50%' };
}

/** fill 集 → background 系列声明。纯色取「最后绘制的」作 background-color（顶层语义） */
export function fillsToCss(fillsRaw: unknown, vars: VarResolver, warnings: Warnings, what: string): CSSDecl[] {
  const entries = Array.isArray(fillsRaw) ? fillsRaw : fillsRaw !== undefined ? [fillsRaw] : [];
  const decls: CSSDecl[] = [];
  const bgImages: string[] = [];
  let bgColor: string | undefined;

  for (const entry of entries) {
    if (typeof entry === 'string' || (isRecord(entry) && entry['type'] === undefined)) {
      bgColor = colorFromFillEntry(entry, vars);
      continue;
    }
    if (!isRecord(entry)) continue;
    const kind = entry['type'];
    if (kind === 'color') {
      bgColor = colorFromFillEntry(entry, vars);
    } else if (kind === 'gradient') {
      const gType = entry['gradientType'];
      const stops = stopsToCssList(entry['colors'], vars);
      if (stops === undefined) {
        warnings.push(`${what}: 渐变缺少可用色标，已跳过`);
        continue;
      }
      const rot = vars.resolveNum(entry['rotation'] as number | string) ?? 0;
      if (gType === 'linear') {
        bgImages.push(`linear-gradient(${penAngleToCss(rot)}, ${stops})`);
      } else if (gType === 'radial') {
        const c = normCenter(entry['center']);
        bgImages.push(`radial-gradient(ellipse at ${c.x} ${c.y}, ${stops})`);
      } else if (gType === 'angular') {
        bgImages.push(`conic-gradient(from ${penAngleToCss(rot)} at 50% 50%, ${stops})`);
      } else {
        // gradientType 缺省按 linear（spec 未标默认，实测文件多为 linear）
        bgImages.push(`linear-gradient(${penAngleToCss(rot)}, ${stops})`);
      }
    } else if (kind === 'image') {
      const url = entry['url'];
      if (typeof url === 'string' && url !== '') {
        bgImages.push(`url("${url.replace(/"/g, '%22')}")`);
        const mode = entry['mode'];
        if (mode === 'contain') decls.push(['background-size', 'contain']);
        else if (mode === 'stretch') decls.push(['background-size', '100% 100%']);
        else decls.push(['background-size', 'cover']);
        decls.push(['background-position', 'center']);
        decls.push(['background-repeat', 'no-repeat']);
      } else {
        warnings.push(`${what}: 图像填充缺少 url，已跳过`);
      }
    } else if (kind === 'mesh_gradient') {
      const first = colorFromFillEntry((entry['colors'] as unknown[])?.[0], vars);
      if (first) {
        bgColor = first;
        warnings.push(`${what}: mesh_gradient 降级为首个顶点色`);
      } else {
        warnings.push(`${what}: mesh_gradient 无法降级，已跳过`);
      }
    } else if (kind === 'shader') {
      warnings.push(`${what}: shader 填充暂不支持渲染，已跳过`);
    }
  }
  if (bgImages.length > 0) decls.unshift(['background-image', bgImages.join(', ')]);
  if (bgColor !== undefined) decls.unshift(['background-color', bgColor]);
  return decls;
}

/** stroke → border 系列。v1 只支持纯色、均匀或四边宽度；alignment 非 inner 时警告 */
export function strokeToCss(node: AnyNode, vars: VarResolver, warnings: Warnings, what: string): CSSDecl[] {
  const stroke = node['stroke'];
  if (stroke === undefined) return [];
  const entries = Array.isArray(stroke) ? stroke : [stroke];
  const firstColor = entries.map((e) => colorFromFillEntry(e, vars)).find((c) => c !== undefined);
  const decls: CSSDecl[] = [];
  if (firstColor !== undefined) decls.push(['border-color', firstColor]);
  if (entries.length > 1) warnings.push(`${what}: 多层描边仅渲染第一层`);

  const widthRaw = node['strokeWidth'];
  if (typeof widthRaw === 'number') {
    decls.push(['border-width', `${widthRaw}px`]);
    decls.push(['border-style', 'solid']);
  } else if (isRecord(widthRaw)) {
    const sides: CSSDecl[] = [];
    for (const [k, cssName] of [['top', 'border-top'], ['right', 'border-right'], ['bottom', 'border-bottom'], ['left', 'border-left']] as const) {
      const w = vars.resolveNum(widthRaw[k] as number | string);
      if (w !== undefined) {
        sides.push([`${cssName}-width`, `${w}px`]);
        sides.push([`${cssName}-style`, 'solid']);
      }
    }
    decls.push(...sides);
  } else if (firstColor !== undefined) {
    decls.push(['border-width', '1px']);
    decls.push(['border-style', 'solid']);
  }

  const align = node['strokeAlignment'];
  if (align === 'outer' || align === 'center') {
    warnings.push(`${what}: strokeAlignment=${String(align)} 暂按 inner（CSS border）语义渲染`);
  }
  return decls;
}

/** effect → box-shadow / filter / backdrop-filter */
export function effectsToCss(effectsRaw: unknown, vars: VarResolver, warnings: Warnings, what: string): CSSDecl[] {
  if (effectsRaw === undefined) return [];
  const entries = Array.isArray(effectsRaw) ? effectsRaw : [effectsRaw];
  const decls: CSSDecl[] = [];
  const shadows: string[] = [];
  let blurPx: number | undefined;
  let bgBlurPx: number | undefined;

  for (const e of entries) {
    if (!isRecord(e)) continue;
    if (e['type'] === 'shadow') {
      const inner = e['shadowType'] === 'inner';
      const off = isRecord(e['offset']) ? e['offset'] : {};
      const x = vars.resolveNum(off['x'] as number | string) ?? 0;
      const y = vars.resolveNum(off['y'] as number | string) ?? 0;
      const b = vars.resolveNum(e['blur'] as number | string) ?? 0;
      const c = colorFromFillEntry(e['color'], vars) ?? 'rgba(0,0,0,0.25)';
      shadows.push(`${inner ? 'inset ' : ''}${x}px ${y}px ${b}px ${c}`);
    } else if (e['type'] === 'blur') {
      blurPx = Math.max(blurPx ?? 0, vars.resolveNum(e['radius'] as number | string) ?? 0);
    } else if (e['type'] === 'background_blur') {
      bgBlurPx = Math.max(bgBlurPx ?? 0, vars.resolveNum(e['radius'] as number | string) ?? 0);
    } else if (e['type'] === 'shader') {
      warnings.push(`${what}: shader 效果暂不支持渲染，已跳过`);
    }
  }
  if (shadows.length > 0) decls.push(['box-shadow', shadows.join(', ')]);
  if (blurPx !== undefined) decls.push(['filter', `blur(${blurPx}px)`]);
  if (bgBlurPx !== undefined) decls.push(['backdrop-filter', `blur(${bgBlurPx}px)`]);
  return decls;
}

/** 文本样式；文本颜色来自 fill（实文件如此：text 节点 fill 即字色） */
export function textToCss(node: AnyNode, vars: VarResolver, warnings: Warnings): CSSDecl[] {
  const decls: CSSDecl[] = [];
  const num = (k: string): number | undefined => vars.resolveNum(node[k] as number | string);
  const str = (k: string): string | undefined => (typeof node[k] === 'string' ? vars.resolve(node[k] as string) : undefined);

  const ff = str('fontFamily');
  if (ff) decls.push(['font-family', ff]);
  const fs = num('fontSize');
  if (fs !== undefined) decls.push(['font-size', `${fs}px`]);
  const fw = str('fontWeight');
  if (fw) decls.push(['font-weight', fw]);
  const fst = str('fontStyle');
  if (fst) decls.push(['font-style', fst]);
  const lh = num('lineHeight');
  if (lh !== undefined) decls.push(['line-height', String(lh)]);
  const ls = num('letterSpacing');
  if (ls !== undefined) decls.push(['letter-spacing', `${ls}px`]);
  const ta = str('textAlign');
  if (ta) decls.push(['text-align', ta]);
  const deco: string[] = [];
  if (vars.resolveBool(node['underline'] as boolean | string)) deco.push('underline');
  if (vars.resolveBool(node['strikethrough'] as boolean | string)) deco.push('line-through');
  if (deco.length > 0) decls.push(['text-decoration', deco.join(' ')]);
  if (node['textAlignVertical'] !== undefined && node['textAlignVertical'] !== 'top') {
    warnings.push('textAlignVertical 暂按 top 渲染');
  }
  // 文字颜色：fill 取首个纯色
  const fillsRaw = node['fill'];
  const entries = Array.isArray(fillsRaw) ? fillsRaw : fillsRaw !== undefined ? [fillsRaw] : [];
  const color = entries.map((e) => colorFromFillEntry(e, vars)).find((c) => c !== undefined);
  if (color !== undefined) decls.push(['color', color]);
  // 增长模式
  const growth = node['textGrowth'];
  if (growth === 'auto') decls.push(['white-space', 'nowrap']);
  if (growth === 'fixed-width-height') decls.push(['overflow', 'visible']);
  return decls;
}

/** 公共：opacity / rotation（逆时针绕左上角）/ flip / clip */
export function commonToCss(node: AnyNode, vars: VarResolver): CSSDecl[] {
  const decls: CSSDecl[] = [];
  const op = vars.resolveNum(node['opacity'] as number | string);
  if (op !== undefined && op !== 1) decls.push(['opacity', String(op)]);
  const transforms: string[] = [];
  const rot = vars.resolveNum(node['rotation'] as number | string);
  if (rot !== undefined && rot !== 0) {
    transforms.push(`rotate(${-rot}deg)`);
    decls.push(['transform-origin', '0 0']);
  }
  if (vars.resolveBool(node['flipX'] as boolean | string)) {
    transforms.push('scaleX(-1)');
    decls.push(['transform-origin', '0 0']);
  }
  if (vars.resolveBool(node['flipY'] as boolean | string)) {
    transforms.push('scaleY(-1)');
    decls.push(['transform-origin', '0 0']);
  }
  if (transforms.length > 0) decls.push(['transform', transforms.join(' ')]);
  if (vars.resolveBool(node['clip'] as boolean | string)) decls.push(['overflow', 'hidden']);
  return decls;
}

/** cornerRadius：均匀或四元组（角顺序按 TL,TR,BR,BL，spec 标 unverified） */
export function cornerRadiusToCss(raw: unknown, vars: VarResolver): CSSDecl[] {
  if (raw === undefined) return [];
  if (typeof raw === 'number' || typeof raw === 'string') {
    const r = vars.resolveNum(raw);
    return r !== undefined ? [['border-radius', `${r}px`]] : [];
  }
  if (Array.isArray(raw) && raw.length === 4) {
    const radii = raw.map((r) => vars.resolveNum(r as number | string));
    if (radii.every((r) => r !== undefined)) {
      return [['border-radius', radii.map((r) => `${r}px`).join(' ')]];
    }
  }
  return [];
}
