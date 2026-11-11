import { describe, expect, it } from 'vitest';
import {
  centerOn,
  clampZoom,
  fitBox,
  levelStepFromWheel,
  IDENTITY,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  parseViewport,
  serializeViewport,
  toCanvas,
  transformCss,
  zoomAt,
  zoomTo,
} from '../ui/src/viewport.js';

describe('锚点缩放', () => {
  it('锚点下的画布点在缩放前后不动（不漂移）', () => {
    const vp = { z: 1, tx: 40, ty: -10 };
    const px = 300;
    const py = 180;
    const before = toCanvas(vp, px, py);
    const after = zoomAt(vp, 1.7, px, py);
    const moved = toCanvas(after, px, py);
    expect(after.z).toBeCloseTo(1.7, 9);
    expect(moved.x).toBeCloseTo(before.x, 9);
    expect(moved.y).toBeCloseTo(before.y, 9);
  });

  it('缩放 ±k 可逆：回到原视口', () => {
    let vp = { z: 1, tx: 12, ty: 34 };
    vp = zoomAt(vp, 2, 500, 250);
    vp = zoomAt(vp, 0.5, 500, 250);
    expect(vp.z).toBeCloseTo(1, 9);
    expect(vp.tx).toBeCloseTo(12, 9);
    expect(vp.ty).toBeCloseTo(34, 9);
  });

  it('倍率被夹在 [MIN_ZOOM, MAX_ZOOM]', () => {
    expect(zoomAt({ z: 1, tx: 0, ty: 0 }, 100, 0, 0).z).toBe(MAX_ZOOM);
    expect(zoomAt({ z: 1, tx: 0, ty: 0 }, 0.0001, 0, 0).z).toBe(MIN_ZOOM);
    expect(clampZoom(0.5)).toBe(0.5);
  });

  it('已在边界上时原样返回（不做无意义位移）', () => {
    const vp = { z: MAX_ZOOM, tx: 5, ty: 6 };
    expect(zoomAt(vp, 2, 100, 100)).toBe(vp);
  });
});

describe('fitBox', () => {
  it('适配后盒完整落在视口内且居中', () => {
    const vp = fitBox({ x: 100, y: 50, w: 800, h: 400 }, { width: 1000, height: 600 });
    const left = 100 * vp.z + vp.tx;
    const top = 50 * vp.z + vp.ty;
    const right = (100 + 800) * vp.z + vp.tx;
    const bottom = (50 + 400) * vp.z + vp.ty;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(1000);
    expect(bottom).toBeLessThanOrEqual(600);
    expect(left).toBeCloseTo(1000 - right, 6); // 左右留白相等
    expect(top).toBeCloseTo(600 - bottom, 6);
  });

  it('受限维度贴满（不过度缩小）', () => {
    const vp = fitBox({ x: 0, y: 0, w: 1000, h: 200 }, { width: 1000, height: 600 });
    expect(vp.z).toBeCloseTo((1000 - 48) / 1000, 9);
  });

  it('超大画布：倍率兜底到 0.02', () => {
    const vp = fitBox({ x: 0, y: 0, w: 200000, h: 200000 }, { width: 1000, height: 600 });
    expect(vp.z).toBe(0.02);
  });

  it('超大画布 fit 后继续缩放，沿用 0.02 下限而不是跳回 0.1', () => {
    const fitted = fitBox({ x: 0, y: 0, w: 200000, h: 200000 }, { width: 1000, height: 600 });
    const zoomed = zoomAt(fitted, 1.01, 500, 300, 0.02);
    expect(zoomed.z).toBeCloseTo(0.0202, 9);
  });

  it('零尺寸盒不除零', () => {
    const vp = fitBox({ x: 10, y: 10, w: 0, h: 0 }, { width: 800, height: 600 });
    expect(Number.isFinite(vp.z)).toBe(true);
    expect(vp.z).toBeGreaterThan(0);
  });
});

describe('Alt+滚轮层级方向', () => {
  it('只认纵向增量；水平滚动或零增量不切换层级', () => {
    expect(levelStepFromWheel(0, -120)).toBe(1);
    expect(levelStepFromWheel(0, 120)).toBe(-1);
    expect(levelStepFromWheel(120, 0)).toBeNull();
    expect(levelStepFromWheel(120, 20)).toBeNull();
  });
});

describe('其他变换', () => {
  it('zoomTo 以视口中心为锚点', () => {
    const vp0 = { z: 2, tx: 0, ty: 0 };
    const centerBefore = toCanvas(vp0, 400, 300);
    const vp = zoomTo(vp0, 1, { width: 800, height: 600 });
    const centerAfter = toCanvas(vp, 400, 300);
    expect(vp.z).toBe(1);
    expect(centerAfter.x).toBeCloseTo(centerBefore.x, 9);
    expect(centerAfter.y).toBeCloseTo(centerBefore.y, 9);
  });

  it('centerOn 保持倍率并把盒居中', () => {
    const vp = centerOn({ x: 2000, y: 1000, w: 300, h: 200 }, { z: 0.5, tx: 0, ty: 0 }, { width: 800, height: 600 });
    expect(vp.z).toBe(0.5);
    expect((2000 + 150) * vp.z + vp.tx).toBeCloseTo(400, 9);
    expect((1000 + 100) * vp.z + vp.ty).toBeCloseTo(300, 9);
  });

  it('panBy 累加且不改倍率', () => {
    expect(panBy({ z: 1.5, tx: 10, ty: 20 }, -5, 7)).toEqual({ z: 1.5, tx: 5, ty: 27 });
  });

  it('transformCss 可直接放进 style', () => {
    expect(transformCss({ z: 0.5, tx: -12.5, ty: 30 })).toBe('translate(-12.5px, 30px) scale(0.5)');
  });

  it('默认视口 = 原样显示', () => {
    expect(transformCss(IDENTITY)).toBe('translate(0px, 0px) scale(1)');
  });
});

describe('持久化序列化', () => {
  it('往返一致（三位小数）', () => {
    const vp = { z: 0.25, tx: -100.3333, ty: 42 };
    expect(parseViewport(serializeViewport(vp))).toEqual({ z: 0.25, tx: -100.333, ty: 42 });
  });

  it('非法输入一律 null', () => {
    expect(parseViewport(null)).toBeNull();
    expect(parseViewport('')).toBeNull();
    expect(parseViewport('not json')).toBeNull();
    expect(parseViewport('{"z":"1","tx":0,"ty":0}')).toBeNull();
    expect(parseViewport('{"z":0,"tx":0,"ty":0}')).toBeNull();
    expect(parseViewport('{"z":1,"tx":null,"ty":0}')).toBeNull();
  });

  it('倍率超界时夹到合法区间', () => {
    expect(parseViewport('{"z":0.001,"tx":0,"ty":0}')?.z).toBe(0.02);
    expect(parseViewport('{"z":99,"tx":0,"ty":0}')?.z).toBe(MAX_ZOOM);
  });
});
