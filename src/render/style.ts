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

/**
 * .pen/.ptr 渐变角度 → CSS 角（度）。
 *
 * 基准：`0` = 从左往右（渐变方向指向右），正值顺时针（Figma 那套手感）。
 * 所以 0 → 90deg（to right）、90 → 0deg（to top）、180 → 270deg（to left）、270 → 180deg（to bottom）。
 *
 * 为什么不用「0 指向上」：设计稿里可见的渐变只剩「流光带」（透明→近白→透明，
 * 从左往右飘的光带），它只有按 0=向右 才是一条竖光带；按 0=向上 会变成横着的一大块。
 * 深色「渐隐覆盖」类节点是「同色→自身透明」，两条约定看不出差别，不必为它们拗。
 */
function penAngleToCss(deg: number): string {
  const normalized = ((90 - deg) % 360 + 360) % 360;
  return `${normalized.toFixed(1)}deg`;
}

function normCenter(c: unknown, vars?: VarResolver): { x: string; y: string } {
  if (isRecord(c)) {
    const rx = vars?.resolveNum(c['x'] as number | string) ?? (typeof c['x'] === 'number' ? c['x'] : undefined);
    const ry = vars?.resolveNum(c['y'] as number | string) ?? (typeof c['y'] === 'number' ? c['y'] : undefined);
    if (rx !== undefined && ry !== undefined) {
      return { x: `${(rx * 100).toFixed(2)}%`, y: `${(ry * 100).toFixed(2)}%` };
    }
  }
  return { x: '50%', y: '50%' };
}

/**
 * 径向渐变的椭圆直径（归一化到自身包围盒）→ CSS `ellipse <rx> <ry>`。
 * 缺省返回 null（用 CSS 默认的 farthest-corner）；`{height:1}` 这类只写一边的，
 * 另一边按正方形处理（与 Pencil 的径向渐变一致）。
 */
function normSize(size: unknown, vars: VarResolver): string | null {
  if (!isRecord(size)) return null;
  const rw = vars.resolveNum(size['width'] as number | string);
  const rh = vars.resolveNum(size['height'] as number | string);
  if (rw === undefined && rh === undefined) return null;
  const w = rw ?? rh ?? 1;
  const h = rh ?? rw ?? 1;
  return `${(w * 100).toFixed(2)}% ${(h * 100).toFixed(2)}%`;
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
    // fills 是叠放列表：`enabled:false` 的层在 Pencil 里不画，别把被关掉的层画上去
    if (vars.resolveBool(entry['enabled'] as boolean | string) === false) continue;
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
        // spec：center 归一化到自身包围盒（默认 0.5/0.5），size 是椭圆直径（默认整框）
        const c = normCenter(entry['center'], vars);
        const sz = normSize(entry['size'], vars);
        bgImages.push(
          sz === null
            ? `radial-gradient(ellipse at ${c.x} ${c.y}, ${stops})`
            : `radial-gradient(ellipse ${sz} at ${c.x} ${c.y}, ${stops})`,
        );
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

/**
 * stroke → CSS。
 *
 * 对齐方式决定用哪套 CSS：
 * - `inner`（默认）：`border` 画在盒子内侧 —— 与 Pencil 的 inner 一致；
 * - `outer`：`outline` 画在外侧，且不占布局（不会把内容挤小）；
 * - `center`：`outline` + 负 offset 半个线宽，线心落在盒子边界上。
 *
 * 旧实现一律按 border 画并只发警告，`outer` 的线会整体偏进 1–2px；
 * 设计稿里 outer 比 inner 还多（editor.pen 76 : 26），值得按真实语义画。
 */
export function strokeToCss(node: AnyNode, vars: VarResolver, warnings: Warnings, what: string): CSSDecl[] {
  const stroke = node['stroke'];
  if (stroke === undefined) return [];
  const entries = Array.isArray(stroke) ? stroke : [stroke];
  const enabled = entries.filter((e) => !(isRecord(e) && e['enabled'] === false));
  if (enabled.length === 0) return [];
  const firstColor = enabled.map((e) => colorFromFillEntry(e, vars)).find((c) => c !== undefined);
  if (firstColor === undefined) return [];
  const decls: CSSDecl[] = [];
  if (enabled.length > 1) warnings.push(`${what}: 多层描边仅渲染第一层`);

  const alignRaw = node['strokeAlignment'];
  const align = alignRaw === 'outer' || alignRaw === 'center' ? alignRaw : 'inner';
  const widthRaw = node['strokeWidth'];

  // 四边独立宽度只在 border 上表达得干净；outline 不支持逐边，退回 border + 警告
  if (isRecord(widthRaw) && align !== 'inner') {
    warnings.push(`${what}: 逐边描边宽度 + strokeAlignment=${align} 暂按 inner（CSS border）渲染`);
  }

  if (!isRecord(widthRaw) && align !== 'inner') {
    const w = vars.resolveNum(widthRaw as number | string) ?? 1;
    decls.push(['outline', `${w}px solid ${firstColor}`]);
    decls.push(['outline-offset', align === 'outer' ? '0' : `${-w / 2}px`]);
    return decls;
  }

  decls.push(['border-color', firstColor]);
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
  } else {
    decls.push(['border-width', '1px']);
    decls.push(['border-style', 'solid']);
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
  // 垂直对齐（spec: text_align_v top/middle/bottom）。文本内容作为匿名 flex item，
  // 用 column + justify-content 做块内垂直对齐；text-align 仍负责水平对齐
  const vaRaw = node['textAlignVertical'];
  const va = typeof vaRaw === 'string' ? vars.resolve(vaRaw) : undefined;
  if (va === 'middle' || va === 'bottom') {
    decls.push(['display', 'flex'], ['flex-direction', 'column'], ['justify-content', va === 'middle' ? 'center' : 'flex-end']);
  } else if (va !== undefined && va !== 'top') {
    warnings.push(`${node['id']}: textAlignVertical=${va} 不在 top/middle/bottom 内，按 top 渲染`);
  }
  // 文字颜色：纯色 → color；渐变 → 背景裁切到字形（background-clip: text）
  const fillDecls = fillsToCss(node['fill'], vars, warnings, 'text');
  const image = fillDecls.find(([p]) => p === 'background-image');
  const color = fillDecls.find(([p]) => p === 'background-color')?.[1];
  if (image !== undefined) {
    decls.push(image);
    decls.push(['-webkit-background-clip', 'text']);
    decls.push(['background-clip', 'text']);
    // color:transparent 与 -webkit-text-fill-color:transparent 双写：
    // 前者是标准写法，后者兜住老版 Safari/Chrome 的裁切实现
    decls.push(['color', 'transparent']);
    decls.push(['-webkit-text-fill-color', 'transparent']);
  } else if (color !== undefined) {
    decls.push(['color', color]);
  }
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
