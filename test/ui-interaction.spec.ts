import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { findBrowser } from '../src/shot/screenshot.js';
import { startDaemon, type DaemonHandle } from '../src/web/daemon.js';
import { sendRequest } from '../src/web/client.js';
import { COMPONENTS_FILE, PRESET_FILE, setPreset } from '../src/doc/project.js';

/**
 * 查看器交互回归（真实 Chromium + 构建产物 ui/dist）：
 * 笔记抽屉、浮动工具条、预设面板、组件画廊——都是纯前端行为，只能真点一遍。
 * 没有 Chromium 或没构建前端时 skip（CI 会先 pnpm build）。
 */

const browserPath = findBrowser();
const uiDist = join(import.meta.dirname, '../ui/dist/index.html');
const canRun = browserPath !== null && existsSync(uiDist);
const browserDescribe = canRun ? describe : describe.skip;

const PROJECT = 'ui-test';

let home: string;
let dir: string;
let daemon: DaemonHandle;
let browser: Browser | undefined;

beforeAll(async () => {
  if (!canRun) return;
  home = mkdtempSync(join(tmpdir(), 'paintress-ui-home-'));
  process.env['PAINTRESS_HOME'] = home;
  dir = mkdtempSync(join(tmpdir(), 'paintress-ui-proj-'));
  copyFileSync(join(import.meta.dirname, 'fixtures/basic.pen'), join(dir, 'design.ptr'));
  writeFileSync(join(dir, 'design.md'), '# 设计说明\n\n这一版把**主色**压暗了一档。\n\n- 待定：图标\n');
  daemon = await startDaemon({ port: 0, idleTimeoutMs: 10 * 60_000, idleCheckMs: 5_000, quiet: true });
  await sendRequest({ kind: 'watch', project: PROJECT, dir });
  setPreset(dir, { key: 'color-brand', type: 'color', value: '#3B82F6', name: '主色' });
  writeFileSync(
    join(dir, COMPONENTS_FILE),
    JSON.stringify(
      {
        version: '2.22',
        fileToken: '00000000-0000-4000-8000-000000000003',
        variables: {},
        children: [
          { type: 'frame', id: 'cmp-btn', name: 'Button / Primary', reusable: true, width: 120, height: 40, fill: '$color-brand' },
        ],
        'x-paintress': { spec: '1', components: { version: 1 } },
      },
      null,
      2,
    ),
  );
  browser = await chromium.launch({
    executablePath: browserPath!,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  if (daemon !== undefined) await daemon.close();
  if (home !== undefined) rmSync(home, { recursive: true, force: true });
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  delete process.env['PAINTRESS_HOME'];
});

async function openViewer(): Promise<Page> {
  if (browser === undefined) throw new Error('浏览器未就绪（beforeAll 未完成）');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${daemon.port}/${PROJECT}?file=design.ptr`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.notes-toggle', { timeout: 15_000 });
  return page;
}

async function widthOf(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`找不到元素：${selector}`);
  return box.width;
}

async function until(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return;
    if (Date.now() > deadline) throw new Error(`等待超时（${timeoutMs}ms）`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

browserDescribe('查看器交互（真实浏览器）', () => {
  it('笔记抽屉：打开收窄画布、图标消失、关闭恢复', async () => {
    const page = await openViewer();
    try {
      const before = await widthOf(page, '.canvas-wrap');
      await page.locator('.notes-toggle').click();
      await page.waitForSelector('.notes-panel');
      await page.waitForSelector('.markdown h1');
      expect(await page.locator('.markdown h1').innerText()).toContain('设计说明');
      // 抽屉固定 380 + gap 12：画布明显收窄
      const after = await widthOf(page, '.canvas-wrap');
      expect(after).toBeLessThan(before - 300);
      expect(await page.locator('.notes-toggle').count()).toBe(0);

      await page.locator('.notes-panel .panel-close').click();
      await page.waitForSelector('.notes-toggle');
      const restored = await widthOf(page, '.canvas-wrap');
      expect(restored).toBeGreaterThan(after + 300);
    } finally {
      await page.close();
    }
  });

  it('浮动工具条：预设面板改值写回文件，组件画廊显示 tile', async () => {
    const page = await openViewer();
    try {
      const rail = page.locator('.rail-btn');
      expect(await rail.count()).toBe(2);

      await rail.nth(0).click();
      await page.waitForSelector('.preset-panel');
      const input = page.locator('.preset-panel .preset-value').first();
      await input.fill('#908030');
      await input.press('Enter');
      await until(() => readFileSync(join(dir, PRESET_FILE), 'utf8').includes('#908030'));

      // 工具条互斥：点组件 → 预设面板收起
      await rail.nth(1).click();
      await page.waitForSelector('.components-panel');
      expect(await page.locator('.preset-panel').count()).toBe(0);
      await page.waitForSelector('.components-panel .tile');
      expect(await page.locator('.components-panel .tile').count()).toBe(1);
      expect(await page.locator('.components-panel figcaption').first().innerText()).toContain('Button');

      // Esc 收起浮层
      await page.keyboard.press('Escape');
      await page.waitForSelector('.components-panel', { state: 'detached' });
    } finally {
      await page.close();
    }
  });
});
