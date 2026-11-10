import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { screenshotPen, findBrowser } from '../src/shot/screenshot.js';

const hasBrowser = findBrowser() !== null;
const d = describe;
if (!hasBrowser) {
  d.skip('截图（无浏览器，跳过）', () => it('noop', () => {}));
} else {
  let tmp: string;
  let penFile: string;
  let pngFile: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'paintress-shot-test-'));
    penFile = join(tmp, 'w.pen');
    pngFile = join(tmp, 'out.png');
    copyFileSync(join(import.meta.dirname, 'fixtures/basic.pen'), penFile);
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  d('截图', () => {
    it('整画布 PNG：文件存在且为 PNG 魔数，尺寸 = 画布 × scale', async () => {
      const res = await screenshotPen(penFile, pngFile, { scale: 2, settleMs: 200 });
      expect(res.canvas).toEqual({ width: 800, height: 600 });
      expect(existsSync(pngFile)).toBe(true);
      const buf = readFileSync(pngFile);
      expect(buf.length).toBeGreaterThan(1000);
      // PNG 魔数 89 50 4E 47
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50);
      expect(buf[2]).toBe(0x4e);
      expect(buf[3]).toBe(0x47);
    }, 30_000);

    it('scale=1 时产物更小', async () => {
      const png1 = join(tmp, 'out1.png');
      await screenshotPen(penFile, png1, { scale: 1, settleMs: 200 });
      expect(readFileSync(png1).length).toBeLessThan(readFileSync(pngFile).length);
    }, 30_000);
  });
}
