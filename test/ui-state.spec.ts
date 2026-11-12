import { describe, expect, it } from 'vitest';
import { detectLang } from '../ui/src/i18n.js';
import { positionFromPointer } from '../ui/src/canvas-bg-math.js';

describe('查看器语言检测', () => {
  it('中文区域设置均为中文', () => {
    for (const language of ['zh', 'zh-CN', 'zh-TW', 'ZH-hans-CN']) {
      expect(detectLang({ language }), language).toBe('zh');
    }
  });

  it('首选语言优先于备用语言；非中文一律英文', () => {
    expect(detectLang({ languages: ['en-US', 'zh-CN'], language: 'zh-CN' })).toBe('en');
    expect(detectLang({ languages: ['ja-JP'], language: 'ja-JP' })).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
});

describe('画布背景滑块坐标', () => {
  const base = { rectLeft: 100, rectWidth: 84, pad: 3, thumb: 20, count: 3 };

  it('三个停靠点映射到 0 / 1 / 2，越界夹取', () => {
    expect(positionFromPointer({ ...base, clientX: 113 })).toBe(0);
    expect(positionFromPointer({ ...base, clientX: 142 })).toBe(1);
    expect(positionFromPointer({ ...base, clientX: 171 })).toBe(2);
    expect(positionFromPointer({ ...base, clientX: 0 })).toBe(0);
    expect(positionFromPointer({ ...base, clientX: 999 })).toBe(2);
  });

  it('轨道中间停靠点为 1；无可用行程时不动', () => {
    expect(positionFromPointer({ ...base, clientX: 142 })?.toFixed(2)).toBe('1.00');
    expect(positionFromPointer({ ...base, clientX: 142, rectWidth: 20 })).toBeNull();
  });
});
