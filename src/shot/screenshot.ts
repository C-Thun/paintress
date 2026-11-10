import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { renderDocument } from '../render/index.js';
import { loadDoc } from '../doc/io.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * 截图层：渲染 → 临时 HTML → headless Chromium → PNG（决策 3：两个消费者分开，AI 要 PNG）。
 * 浏览器探测：PTR_BROWSER 环境变量 → 系统 chrome → playwright 浏览器缓存。
 */

export function findBrowser(): string | null {
  const env = process.env['PTR_BROWSER'];
  if (env && existsSync(env)) return env;
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  const cacheDir = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(cacheDir)) {
    const dirs = readdirSync(cacheDir)
      .filter((d) => d.startsWith('chromium-'))
      .sort((a, b) => b.localeCompare(a)); // 版本号大者优先（取最新）
    for (const d of dirs) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
        const p = join(cacheDir, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

export interface ShotOptions {
  /** 像素倍率（默认 2，出图清晰） */
  scale?: number;
  /** 等待毫秒（字体/图片加载），默认 120 */
  settleMs?: number;
}

export interface ShotResult {
  out: string;
  canvas: { width: number; height: number };
  warnings: string[];
  browser: string;
}

/** 渲染并截图整张画布 */
export async function screenshotPen(penPath: string, outPng: string, opts: ShotOptions = {}): Promise<ShotResult> {
  const browserPath = findBrowser();
  if (!browserPath) {
    throw new Error('未找到可用浏览器：安装 Chromium/Chrome，或设置 PTR_BROWSER 指向可执行文件');
  }
  const loaded = loadDoc(penPath);
  const rendered = renderDocument(loaded.doc);
  const tmpDir = mkdtempSync(join(tmpdir(), 'paintress-shot-'));
  const htmlPath = join(tmpDir, 'page.html');
  writeFileSync(htmlPath, rendered.html, 'utf8');
  try {
    const browser = await chromium.launch({
      executablePath: browserPath,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage({
        viewport: { width: rendered.canvas.width, height: rendered.canvas.height },
        deviceScaleFactor: opts.scale ?? 2,
      });
      await page.goto(`file://${htmlPath}`);
      await page.waitForTimeout(opts.settleMs ?? 120);
      await page.screenshot({ path: outPng, clip: { x: 0, y: 0, width: rendered.canvas.width, height: rendered.canvas.height } });
    } finally {
      await browser.close();
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  const size = statSync(outPng).size;
  if (size === 0) throw new Error('截图产物为空文件');
  return { out: outPng, canvas: rendered.canvas, warnings: rendered.warnings, browser: browserPath };
}
