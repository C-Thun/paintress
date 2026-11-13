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
export function getLucideIcon(name: string, warnings: Warnings): string | null {  if (cache.has(name)) return cache.get(name) ?? null;
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

/**
 * 常见图标库 → lucide 的别名表。
 *
 * 设计稿里除 lucide 外最常出现的是 Material Symbols（名字是 `snake_case`），
 * 不映射就整块渲染成虚线占位框 —— 一个界面里几个关键操作图标全是框，
 * 可读性比「图标形状略有出人」差得多。
 */
const ALIASES: Record<string, string> = {
  // Material Symbols
  check_circle: 'circle-check',
  check: 'check',
  delete: 'trash-2',
  delete_forever: 'trash-2',
  delete_sweep: 'trash-2',
  do_not_disturb_on: 'circle-slash',
  download: 'download',
  upload: 'upload',
  filter_alt: 'filter',
  info: 'info',
  schedule: 'clock',
  history: 'history',
  settings_backup_restore: 'history',
  settings: 'settings',
  zoom_in: 'zoom-in',
  zoom_out: 'zoom-out',
  close: 'x',
  search: 'search',
  visibility: 'eye',
  visibility_off: 'eye-off',
  favorite: 'heart',
  star: 'star',
  play_arrow: 'play',
  pause: 'pause',
  stop: 'square',
  refresh: 'rotate-cw',
  restore: 'rotate-ccw',
  keyboard_arrow_down: 'chevron-down',
  keyboard_arrow_up: 'chevron-up',
  keyboard_arrow_left: 'chevron-left',
  keyboard_arrow_right: 'chevron-right',
  expand_more: 'chevron-down',
  expand_less: 'chevron-up',
  more_vert: 'more-vertical',
  more_horiz: 'more-horizontal',
  folder: 'folder',
  folder_open: 'folder-open',
  image: 'image',
  photo: 'image',
  edit: 'pencil',
  crop: 'crop',
  rotate_left: 'rotate-ccw',
  rotate_right: 'rotate-cw',
  fullscreen: 'maximize',
  fullscreen_exit: 'minimize',
  lock: 'lock',
  lock_open: 'unlock',
  warning: 'triangle-alert',
  error: 'circle-alert',
  help: 'circle-help',
};

/**
 * 把任意图标库里的名字归一成 lucide 名。
 * lucide 自己的名字直接返回；Material Symbols 走别表；
 * 其它库（Font Awesome、自定义字体）也先试别名，再不中就由调用方降级占位。
 */
export function resolveIconName(library: string, name: string): string {
  if (name === '') return name;
  if (library === 'lucide' || library === 'feather') return name;
  const direct = ALIASES[name];
  if (direct !== undefined) return direct;
  // Material Symbols 还有一堆 snake_case 名字恰好与 lucide 同名（download / folder …）
  return name;
}
