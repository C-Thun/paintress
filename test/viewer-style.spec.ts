import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { findBrowser } from '../src/shot/screenshot.js';
import { FRAME_STYLE } from '../ui/src/frame-style.js';

const browserPath = findBrowser();
const browserDescribe = browserPath === null ? describe.skip : describe;

/**
 * chromium 在 CI runner 上首次启动是冷启动（解包后磁盘缓存为空）：
 * 2026-11-12 的 v0.5.0 发版实测约 26s，而 vitest 的 hookTimeout 默认只有 10s，
 * 于是 beforeAll 直接超时、整个文件判失败（应用代码一行没坏）。
 */
const BROWSER_LAUNCH_TIMEOUT_MS = 60_000;

browserDescribe('查看器变更高亮（真实浏览器计算样式）', () => {
  let browser: Browser | undefined;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: browserPath!, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  }, BROWSER_LAUNCH_TIMEOUT_MS);

  afterAll(async () => {
    // beforeAll 超时后 browser 仍是 undefined；不判会让 afterAll 再抛 TypeError，把根因盖住
    await browser?.close();
  });

  it('2px 外框的透明度确实随关键帧变化，不被基线声明压住', async () => {
    if (browser === undefined) throw new Error('浏览器未就绪（beforeAll 未完成）');
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
