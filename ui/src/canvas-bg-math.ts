export interface PointerGeometry {
  clientX: number;
  rectLeft: number;
  rectWidth: number;
  pad: number;
  thumb: number;
  count: number;
}

/** 三档滑块的指针坐标 → 连续档位（0..count-1）。纯函数便于回归测试。 */
export function positionFromPointer(geometry: PointerGeometry): number | null {
  const { clientX, rectLeft, rectWidth, pad, thumb, count } = geometry;
  const travel = rectWidth - pad * 2 - thumb;
  if (travel <= 0 || count < 2) return null;
  const ratio = (clientX - rectLeft - pad - thumb / 2) / travel;
  return Math.max(0, Math.min(count - 1, ratio * (count - 1)));
}
