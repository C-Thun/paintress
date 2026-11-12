import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { findBrowser } from '../src/shot/screenshot.js';
import { FRAME_STYLE } from '../ui/src/frame-style.js';

const browserPath = findBrowser();
const browserDescribe = browserPath === null ? describe.skip : describe;

browserDescribe('查看器变更高亮（真实浏览器计算样式）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: browserPath!, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  });

  afterAll(async () => {
    await browser.close();
  });

  it('2px 外框的透明度确实随关键帧变化，不被基线声明压住', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`<style>${FRAME_STYLE}</style><div id="changed" data-ptr-changed style="width:100px;height:100px"></div>`);
      const node = page.locator('#changed');
      // 经 ownerDocument.defaultView 取浏览器 API：测试进程本身的 tsconfig 不带 DOM 全局
      const first = await node.evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).boxShadow);
      await page.waitForTimeout(500);
      const second = await node.evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).boxShadow);

      expect(first).toContain('2px');
      expect(second).toContain('2px');
      // 回归：基线 box-shadow 带 !important 时，两次读数始终完全相同
      expect(second).not.toBe(first);
    } finally {
      await page.close();
    }
  });
});
