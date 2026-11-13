import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { renderDocument, type BoardBox } from '../render/index.js';
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
  /** 只截某个画板（id 或 name；匹配规则见 selectBoard） */
  board?: string;
}

export interface ShotBoard {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShotResult {
  out: string;
  canvas: { width: number; height: number };
  /** 按画板截图时命中的画板（未指定时为 undefined） */
  board?: ShotBoard;
  warnings: string[];
  browser: string;
}

function boardLabel(b: BoardBox): string {
  return b.name !== undefined && b.name !== '' ? `${b.name}(id=${b.id})` : b.id;
}

/**
 * 画板选择子：id 精确 → name 精确 → name/id 模糊（不区分大小写）。
 * 模糊命中多个时报歧义并列出候选，不猜——猜错会让 AI 以为看到了另一页。
 */
export function selectBoard(boards: readonly BoardBox[], query: string): BoardBox {
  if (boards.length === 0) throw new Error('设计稿没有画板（顶层节点为空），无法按画板截图');
  const q = query.trim();
  if (q === '') throw new Error('board 参数不能为空');

  const byId = boards.filter((b) => b.id === q);
  if (byId.length === 1) return byId[0] as BoardBox;
  const byName = boards.filter((b) => b.name === q);
  if (byName.length === 1) return byName[0] as BoardBox;

  const lower = q.toLowerCase();
  const fuzzy = boards.filter(
    (b) => b.id.toLowerCase().includes(lower) || (b.name ?? '').toLowerCase().includes(lower),
  );
  if (fuzzy.length === 1) return fuzzy[0] as BoardBox;
  const all = boards.map(boardLabel).join('、');
  if (fuzzy.length === 0) throw new Error(`没有匹配「${q}」的画板；可选：${all}`);
  throw new Error(`「${q}」命中 ${fuzzy.length} 个画板，请写更精确的名字或 id：${fuzzy.map(boardLabel).join('、')}`);
}

/** 渲染并截图整张画布；指定 board 时只裁该画板（走同一套渲染与浏览器） */
export async function screenshotPen(penPath: string, outPng: string, opts: ShotOptions = {}): Promise<ShotResult> {
  const browserPath = findBrowser();
  if (!browserPath) {
    throw new Error('未找到可用浏览器：安装 Chromium/Chrome，或设置 PTR_BROWSER 指向可执行文件');
  }
  const loaded = loadDoc(penPath);
  const rendered = renderDocument(loaded.doc);
  const target = opts.board !== undefined ? selectBoard(rendered.boards, opts.board) : undefined;
  // 只有「显式存了尺寸」的画板才能在开浏览器前判定为 0；自动尺寸的板子要进去量了才知道
  const tmpDir = mkdtempSync(join(tmpdir(), 'paintress-shot-'));
  const htmlPath = join(tmpDir, 'page.html');
  writeFileSync(htmlPath, rendered.html, 'utf8');
  let clip: { x: number; y: number; width: number; height: number };
  let measuredBoard: BoardBox | undefined;
  try {
    const browser = await chromium.launch({
      executablePath: browserPath,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      // 先给一个够大的视野：自动尺寸的板子（h 未存）只有浏览器知道真实大小
      const page = await browser.newPage({
        viewport: {
          width: Math.max(800, rendered.canvas.width, target !== undefined ? Math.ceil(target.x + 3200) : 0),
          height: Math.max(600, rendered.canvas.height, target !== undefined ? Math.ceil(target.y + 3200) : 0),
        },
        deviceScaleFactor: opts.scale ?? 2,
      });
      await page.goto(`file://${htmlPath}`);
      await page.waitForTimeout(opts.settleMs ?? 120);
      // 用字符串表达式：src 侧没有 DOM 类型库，也不需要为测量引入一份
      const measuredScript = `(() => {
        const canvasEl = document.querySelector('.ptr-canvas');
        const cr = canvasEl ? canvasEl.getBoundingClientRect() : null;
        const nodes = Array.from(document.querySelectorAll('[data-board]'));
        const boards = nodes.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            id: el.getAttribute('data-node-id') || '',
            name: el.getAttribute('data-board-name') || undefined,
            x: cr ? r.left - cr.left : 0,
            y: cr ? r.top - cr.top : 0,
            w: r.width,
            h: r.height
          };
        });
        // 自动尺寸的设计稿常常撑出 .ptr-canvas 的固定宽高：以真实内容盒为准
        let contentW = cr ? cr.width : 0;
        let contentH = cr ? cr.height : 0;
        for (const b of boards) {
          contentW = Math.max(contentW, b.x + b.w);
          contentH = Math.max(contentH, b.y + b.h);
        }
        return { width: Math.ceil(contentW), height: Math.ceil(contentH), boards };
      })()`;
      const measured = (await page.evaluate(measuredScript)) as {
        width: number;
        height: number;
        boards: { id: string; name?: string; x: number; y: number; w: number; h: number }[];
      };

      const realTarget =
        target === undefined
          ? undefined
          : (measured.boards.find((b) => b.id === target.id) ?? undefined);
      if (realTarget !== undefined && target !== undefined) {
        if (realTarget.w <= 0 || realTarget.h <= 0) {
          throw new Error(`画板 ${boardLabel(target)} 尺寸为 0（${realTarget.w}×${realTarget.h}），无法截图`);
        }
        measuredBoard = {
          id: target.id,
          ...(target.name !== undefined ? { name: target.name } : {}),
          x: Math.round(realTarget.x),
          y: Math.round(realTarget.y),
          w: realTarget.w,
          h: realTarget.h,
        };
      } else if (target !== undefined) {
        if (target.w <= 0 || target.h <= 0) {
          throw new Error(`画板 ${boardLabel(target)} 尺寸为 0（${target.w}×${target.h}），无法截图`);
        }
        measuredBoard = { id: target.id, ...(target.name !== undefined ? { name: target.name } : {}), x: target.x, y: target.y, w: target.w, h: target.h };
      }

      const box = measuredBoard ?? { x: 0, y: 0, w: measured.width, h: measured.height };
      clip = {
        x: Math.max(0, Math.floor(box.x)),
        y: Math.max(0, Math.floor(box.y)),
        width: Math.max(1, Math.ceil(box.w)),
        height: Math.max(1, Math.ceil(box.h)),
      };
      // Playwright 的 clip 必须落在 viewport 内：量出来的内容比预估大时先扩视口
      const vp = page.viewportSize();
      const needW = clip.x + clip.width;
      const needH = clip.y + clip.height;
      if (vp === null || vp.width < needW || vp.height < needH) {
        await page.setViewportSize({
          width: Math.max(vp?.width ?? 0, needW),
          height: Math.max(vp?.height ?? 0, needH),
        });
        await page.waitForTimeout(20);
      }
      await page.screenshot({ path: outPng, clip });
    } finally {
      await browser.close();
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  const size = statSync(outPng).size;
  if (size === 0) throw new Error('截图产物为空文件');
  const canvas = { width: Math.max(rendered.canvas.width, clip.x + clip.width), height: Math.max(rendered.canvas.height, clip.y + clip.height) };
  const result: ShotResult = { out: outPng, canvas, warnings: rendered.warnings, browser: browserPath };
  if (measuredBoard !== undefined) {
    result.board = {
      id: measuredBoard.id,
      ...(measuredBoard.name !== undefined ? { name: measuredBoard.name } : {}),
      x: measuredBoard.x,
      y: measuredBoard.y,
      width: measuredBoard.w,
      height: measuredBoard.h,
    };
  }
  return result;
}
