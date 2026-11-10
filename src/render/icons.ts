import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Warnings } from './vars.js';

/**
 * lucide-static 图标加载：运行时按需 fs 读单个 SVG（不打进 bundle），
 * 包缺失/图标不存在 → null + 警告，由调用方渲染占位框。
 */

let iconsDir: string | null | undefined;
const cache = new Map<string, string | null>();

function resolveIconsDir(): string | null {
  if (iconsDir !== undefined) return iconsDir;
  try {
    const req = createRequire(import.meta.url);
    const pkgPath = req.resolve('lucide-static/package.json');
    iconsDir = join(dirname(pkgPath), 'icons');
  } catch {
    iconsDir = null;
  }
  return iconsDir;
}

function toKebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** 取图标 SVG（已剥离许可注释）；不可用返回 null */
export function getLucideIcon(name: string, warnings: Warnings): string | null {
  if (cache.has(name)) return cache.get(name) ?? null;
  let result: string | null = null;
  const dir = resolveIconsDir();
  if (dir === null) {
    warnings.push('lucide-static 未安装，图标渲染为占位框');
  } else {
    try {
      const raw = readFileSync(join(dir, `${toKebab(name)}.svg`), 'utf8');
      // 剥离文件头许可注释（<!-- ... -->）
      result = raw.replace(/^<!--[\s\S]*?-->\s*/, '').trim();
    } catch {
      warnings.push(`图标 "${name}" 不在 lucide 图标集中，渲染为占位框`);
    }
  }
  cache.set(name, result);
  return result;
}
