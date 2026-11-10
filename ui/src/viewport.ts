/**
 * 视口变换的纯数学（specs/canvas-interaction.md §2.1）。
 *
 * 屏幕坐标 = 画布坐标 × z + t（transform-origin: 0 0）。
 * 所有函数都是纯函数，DOM 与存储无关，便于单测锚点缩放不漂移。
 */

export interface Viewport {
  /** 缩放倍率 */
  z: number;
  /** 平移（px） */
  tx: number;
  ty: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  width: number;
  height: number;
}

/** 常规缩放上下限（specs §2.1「范围 0.1–4」） */
export const MIN_ZOOM = 0.1;
/** 超大画布 fit 时的兜底下限（specs §2.4「设下限 0.02」） */
export const MIN_FIT_ZOOM = 0.02;
export const MAX_ZOOM = 4;
export const FIT_PADDING = 24;

export const IDENTITY: Viewport = { z: 1, tx: 0, ty: 0 };

export function clampZoom(z: number, min = MIN_ZOOM): number {
  return Math.min(MAX_ZOOM, Math.max(min, z));
}

/** 以视口内坐标 (px,py) 为锚点缩放：该点下的画布内容在屏幕上保持不动 */
export function zoomAt(vp: Viewport, factor: number, px: number, py: number, min = MIN_ZOOM): Viewport {
  const z = clampZoom(vp.z * factor, min);
  if (z === vp.z) return vp;
  const k = z / vp.z;
  return { z, tx: px - (px - vp.tx) * k, ty: py - (py - vp.ty) * k };
}

/** 缩放到指定倍率，锚点为视口中心 */
export function zoomTo(vp: Viewport, z: number, viewport: Size, min = MIN_ZOOM): Viewport {
  const target = clampZoom(z, min);
  return zoomAt(vp, target / vp.z, viewport.width / 2, viewport.height / 2, min);
}

/** 把某个盒（画板或整画布）适配进视口并居中 */
export function fitBox(box: Box, viewport: Size, padding = FIT_PADDING): Viewport {
  const w = Math.max(1, box.w);
  const h = Math.max(1, box.h);
  const availW = Math.max(1, viewport.width - padding * 2);
  const availH = Math.max(1, viewport.height - padding * 2);
  const z = clampZoom(Math.min(availW / w, availH / h), MIN_FIT_ZOOM);
  return {
    z,
    tx: (viewport.width - w * z) / 2 - box.x * z,
    ty: (viewport.height - h * z) / 2 - box.y * z,
  };
}

/** 保持当前倍率，把盒居中 */
export function centerOn(box: Box, vp: Viewport, viewport: Size): Viewport {
  return {
    z: vp.z,
    tx: viewport.width / 2 - (box.x + box.w / 2) * vp.z,
    ty: viewport.height / 2 - (box.y + box.h / 2) * vp.z,
  };
}

export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return { z: vp.z, tx: vp.tx + dx, ty: vp.ty + dy };
}

/** 屏幕 → 画布坐标（命中测试与调试用） */
export function toCanvas(vp: Viewport, px: number, py: number): { x: number; y: number } {
  return { x: (px - vp.tx) / vp.z, y: (py - vp.ty) / vp.z };
}

export function transformCss(vp: Viewport): string {
  return `translate(${vp.tx}px, ${vp.ty}px) scale(${vp.z})`;
}

/** localStorage 序列化：三位小数足够，避免长浮点串 */
export function serializeViewport(vp: Viewport): string {
  const r = (n: number): number => Math.round(n * 1000) / 1000;
  return JSON.stringify({ z: r(vp.z), tx: r(vp.tx), ty: r(vp.ty) });
}

/** 反序列化：任何非法输入都退回 null（调用方自行决定默认值） */
export function parseViewport(raw: string | null): Viewport | null {
  if (raw === null || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  const { z, tx, ty } = o;
  if (typeof z !== 'number' || typeof tx !== 'number' || typeof ty !== 'number') return null;
  if (!Number.isFinite(z) || !Number.isFinite(tx) || !Number.isFinite(ty)) return null;
  if (z <= 0) return null;
  return { z: clampZoom(z, MIN_FIT_ZOOM), tx, ty };
}
