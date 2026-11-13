import { describe, expect, it } from 'vitest';
import { detectLang } from '../ui/src/i18n.js';

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
