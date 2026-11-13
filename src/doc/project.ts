import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadDoc, saveDoc } from './io.js';
import { PEN_DOC_VERSION, type PenDocument } from '../schema/index.js';

/**
 * 项目级预设与组件库（规格见 specs/project-presets.md、specs/components.md）。
 *
 * 约定：项目根 = 从设计稿所在目录向上找、最近的含 `__preset.ptr` / `__components.ptr` 的目录。
 * 两个文件都是**普通设计稿**：预设值走原生 `variables`，组件走 `reusable`；项目级语义只放在
 * `x-paintress` 扩展位里。因此 pen 读取器看到它们仍是合法文档。
 */

export const PRESET_FILE = '__preset.ptr';
export const COMPONENTS_FILE = '__components.ptr';

/** 预设类型：一期只做颜色与倒角；值是字串，落盘按变量真实类型 */
export type PresetType = 'color' | 'radius';

export interface PresetItem {
  /** 变量名，设计稿里用 `$key` 引用 */
  key: string;
  type: PresetType;
  /** 人看的名称，缺省回退到 key */
  name: string;
  /** 统一用字串对外（color: '#RRGGBB'，radius: '6'） */
  value: string;
}

export interface PresetFile {
  path: string;
  doc: PenDocument;
  mtimeMs: number;
  items: PresetItem[];
}

export function isPresetType(v: unknown): v is PresetType {
  return v === 'color' || v === 'radius';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 目录 → 项目根（最近的含预设/组件文件的祖先目录）；找不到返回 null */
export function findProjectRoot(from: string): string | null {
  let dir = resolve(from);
  try {
    if (!statSync(dir).isDirectory()) dir = dirname(dir);
  } catch {
    dir = dirname(dir);
  }
  for (;;) {
    if (existsSync(join(dir, PRESET_FILE)) || existsSync(join(dir, COMPONENTS_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir || !parent.startsWith(sep)) return null;
    dir = parent;
  }
}

/** 传入文件 → 其所在目录；传入目录 → 自身 */
function projectDirOf(from: string): string {
  const abs = resolve(from);
  try {
    return statSync(abs).isDirectory() ? abs : dirname(abs);
  } catch {
    return dirname(abs);
  }
}

/** 从设计稿 / 目录定位预设文件（存在才算命中） */
export function presetPathFor(from: string): string | null {
  const root = findProjectRoot(from);
  if (root === null) return null;
  const p = join(root, PRESET_FILE);
  return existsSync(p) ? p : null;
}

export function componentsPathFor(from: string): string | null {
  const root = findProjectRoot(from);
  if (root === null) return null;
  const p = join(root, COMPONENTS_FILE);
  return existsSync(p) ? p : null;
}

function presetKindOf(key: string, doc: PenDocument): PresetType | null {
  const meta = (doc as Record<string, unknown>)['x-paintress'];
  const items = isRecord(meta) && isRecord(meta['presets']) ? meta['presets']['items'] : undefined;
  const declared = isRecord(items) && isRecord(items[key]) ? items[key]['type'] : undefined;
  if (isPresetType(declared)) return declared;
  // 无 metadata 的手写文件：按变量类型回退
  const def = doc.variables?.[key];
  const t = isRecord(def) ? def['type'] : undefined;
  if (t === 'color') return 'color';
  if (t === 'number') return 'radius';
  return null;
}

/** 读预设文件；不存在返回 null。结构错误直接抛出（带路径上下文） */
export function readPresetFile(path: string): PresetFile | null {
  if (!existsSync(path)) return null;
  const loaded = loadDoc(path);
  const items: PresetItem[] = [];
  for (const [key, def] of Object.entries(loaded.doc.variables ?? {})) {
    if (!isRecord(def)) continue;
    const type = presetKindOf(key, loaded.doc);
    if (type === null) continue;
    const raw = def['value'];
    if (Array.isArray(raw)) continue; // 主题分派的值不进预设面板（一期不做）
    const meta = (loaded.doc as Record<string, unknown>)['x-paintress'];
    const metaItems = isRecord(meta) && isRecord(meta['presets']) ? meta['presets']['items'] : undefined;
    const declared = isRecord(metaItems) && isRecord(metaItems[key]) ? metaItems[key] : undefined;
    items.push({
      key,
      type,
      name: typeof declared?.['name'] === 'string' && declared['name'] !== '' ? declared['name'] : key,
      value: String(raw),
    });
  }
  items.sort((a, b) => (a.type === b.type ? a.key.localeCompare(b.key) : a.type.localeCompare(b.type)));
  return { path, doc: loaded.doc, mtimeMs: loaded.mtimeMs, items };
}

/** 项目预设（从任意设计稿/目录出发）；没有项目或没有文件都返回空列表 */
export function listPresets(from: string): { path: string | null; items: PresetItem[] } {
  const path = presetPathFor(from);
  if (path === null) return { path: null, items: [] };
  const file = readPresetFile(path);
  return { path, items: file?.items ?? [] };
}

/**
 * 渲染/校验用的副本：预设打底，文档本地同名变量优先。
 * **绝不能拿去保存** —— 否则一次写入就把预设值烤进了设计稿。
 */
export function withProjectPresets(doc: PenDocument, presetDoc: PenDocument | null): PenDocument {
  const vars = presetDoc?.variables;
  if (!vars || Object.keys(vars).length === 0) return doc;
  return { ...doc, variables: { ...vars, ...(doc.variables ?? {}) } };
}

/**
 * 渲染 / 校验用：按设计稿所在项目的预设补全变量，返回**副本**（绝不可拿去保存）。
 * 这是「预设只在项目里存一份」的唯一兑付点：渲染、截图、校验、写前检查都走这里。
 */
export function applyProjectPresets(
  doc: PenDocument,
  filePath: string,
): { doc: PenDocument; presetNames: Set<string> } {
  const p = presetPathFor(filePath);
  const presetDoc = p === null ? null : (readPresetFile(p)?.doc ?? null);
  return { doc: withProjectPresets(doc, presetDoc), presetNames: presetVarNames(presetDoc) };
}

/** 项目预设提供的变量名（校验用；只读名字，不做合并） */
export function projectPresetNames(filePath: string): Set<string> {
  const p = presetPathFor(filePath);
  if (p === null) return new Set();
  return presetVarNames(readPresetFile(p)?.doc ?? null);
}

/** 预设文件对应的变量名集合（校验时用来区分「未定义」与「来自项目预设」） */
export function presetVarNames(presetDoc: PenDocument | null): Set<string> {
  return new Set(Object.keys(presetDoc?.variables ?? {}));
}

const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** 值归一：对外字串 → 落盘值；类型不合法时抛出可读错误 */
export function normalizePresetValue(type: PresetType, value: string): string | number {
  const raw = value.trim();
  if (type === 'color') {
    if (!COLOR_RE.test(raw)) throw new Error(`颜色预设只接受 #RGB / #RRGGBB / #RRGGBBAA，收到：${value}`);
    return raw.toUpperCase();
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`倒角预设只接受非负数，收到：${value}`);
  return n;
}

/** 变量表里的 type：color → color，radius → number */
function varTypeOf(type: PresetType): 'color' | 'number' {
  return type === 'color' ? 'color' : 'number';
}

function presetMetaItems(doc: PenDocument): Record<string, Record<string, unknown>> {
  const meta = (doc as Record<string, unknown>)['x-paintress'];
  const presets = isRecord(meta) ? meta['presets'] : undefined;
  const items = isRecord(presets) ? presets['items'] : undefined;
  return isRecord(items) ? (items as Record<string, Record<string, unknown>>) : {};
}

function emptyDoc(): PenDocument {
  return {
    version: PEN_DOC_VERSION,
    fileToken: randomUUID(),
    variables: {},
    children: [],
  } as PenDocument;
}

export interface ScaffoldResult {
  /** 本次新建的文件（已存在的不会出现在这里） */
  created: string[];
}

/** 注册项目时确保两个文件存在；已存在则一个字都不动 */
export function ensureProjectScaffold(root: string): ScaffoldResult {
  const created: string[] = [];
  const targets: { file: string; doc: PenDocument }[] = [
    { file: PRESET_FILE, doc: { ...emptyDoc(), ['x-paintress']: { spec: '1', presets: { version: 1, items: {} } } } as PenDocument },
    { file: COMPONENTS_FILE, doc: { ...emptyDoc(), ['x-paintress']: { spec: '1', components: { version: 1 } } } as PenDocument },
  ];
  for (const t of targets) {
    const path = join(root, t.file);
    if (existsSync(path)) continue;
    try {
      saveDoc(path, t.doc, { flavor: 'ptr', createOnly: true });
      created.push(path);
    } catch (cause) {
      // 并发创建（另一个 agent/进程刚建好）不算失败
      if (existsSync(path)) continue;
      throw cause;
    }
  }
  return { created };
}

export interface SetPresetInput {
  key: string;
  type: PresetType;
  value: string;
  name?: string;
}

/** 写一条预设（新建或改值）；返回最新列表。from 可以是设计稿、预设文件或目录 */
export function setPreset(from: string, input: SetPresetInput): PresetItem[] {
  const key = input.key.trim();
  if (key === '') throw new Error('预设 key 不能为空');
  if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`预设 key 只允许字母数字与 . _ -，收到：${key}`);

  let path = presetPathFor(from);
  if (path === null) {
    // 没有项目文件就当场初始化（CLI / MCP 不该强制先起 daemon 才能写预设）
    const root = findProjectRoot(from) ?? projectDirOf(from);
    ensureProjectScaffold(root);
    path = join(root, PRESET_FILE);
  }

  const file = readPresetFile(path);
  const doc: PenDocument = file?.doc ?? emptyDoc();
  const value = normalizePresetValue(input.type, input.value);

  const variables: Record<string, unknown> = { ...(doc.variables ?? {}) };
  variables[key] = { type: varTypeOf(input.type), value };
  const metaItems = { ...presetMetaItems(doc) };
  metaItems[key] = { type: input.type, ...(input.name !== undefined && input.name !== '' ? { name: input.name } : {}) };

  const next = {
    ...doc,
    variables,
    ['x-paintress']: {
      ...((doc as Record<string, unknown>)['x-paintress'] as Record<string, unknown> | undefined),
      spec: '1',
      presets: { version: 1, items: metaItems },
    },
  } as PenDocument;

  saveDoc(path, next, {
    flavor: 'ptr',
    ...(file !== null ? { expectedMtimeMs: file.mtimeMs } : {}),
  });
  return readPresetFile(path)?.items ?? [];
}

/** 删一条预设；返回最新列表（不存在时什么都不做） */
export function removePreset(from: string, key: string): PresetItem[] {
  const path = presetPathFor(from);
  if (path === null) return [];
  const file = readPresetFile(path);
  if (file === null) return [];
  const variables = { ...(file.doc.variables ?? {}) };
  if (!(key in variables)) return file.items;
  delete variables[key];
  const metaItems = { ...presetMetaItems(file.doc) };
  delete metaItems[key];
  const next = {
    ...file.doc,
    variables,
    ['x-paintress']: {
      ...((file.doc as Record<string, unknown>)['x-paintress'] as Record<string, unknown> | undefined),
      spec: '1',
      presets: { version: 1, items: metaItems },
    },
  } as PenDocument;
  saveDoc(path, next, { flavor: 'ptr', expectedMtimeMs: file.mtimeMs });
  return readPresetFile(path)?.items ?? [];
}

/** 全树按 id 找节点（组件库、复制插入、画廊都用这一处） */
export function findNodeIn(nodes: unknown[], id: string): Record<string, unknown> | null {
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const rec = n as Record<string, unknown>;
    if (rec['id'] === id) return rec;
    const kids = rec['children'];
    if (Array.isArray(kids)) {
      const hit = findNodeIn(kids, id);
      if (hit !== null) return hit;
    }
  }
  return null;
}

export interface ComponentEntry {
  id: string;
  name: string;
  type: string;
  /** 节点的显式宽高（布局行为字/缺省时不算出来，交给渲染包围盒） */
  width?: number;
  height?: number;
}

/** 组件库里的所有 reusable 节点（全树扫描） */
export function listComponents(componentsPath: string): ComponentEntry[] {
  const file = readPresetFile(componentsPath); // 复用「读文档」这一层，items 忽略
  const doc = file?.doc ?? loadDoc(componentsPath).doc;
  const out: ComponentEntry[] = [];
  const walk = (nodes: unknown[]): void => {
    for (const n of nodes) {
      if (!isRecord(n)) continue;
      if (n['reusable'] === true && typeof n['id'] === 'string') {
        out.push({
          id: n['id'],
          name: typeof n['name'] === 'string' && n['name'] !== '' ? n['name'] : n['id'],
          type: typeof n['type'] === 'string' ? n['type'] : '?',
          ...(typeof n['width'] === 'number' ? { width: n['width'] } : {}),
          ...(typeof n['height'] === 'number' ? { height: n['height'] } : {}),
        });
      }
      const kids = n['children'];
      if (Array.isArray(kids)) walk(kids);
    }
  };
  walk(doc.children ?? []);
  return out;
}

/** 读组件库文件（含 mtime，供乐观并发写入用） */
export function readComponentsFile(path: string): { doc: PenDocument; mtimeMs: number } | null {
  if (!existsSync(path)) return null;
  const loaded = loadDoc(path);
  return { doc: loaded.doc, mtimeMs: loaded.mtimeMs };
}

/** 备注：`readFileSync` 保留给调用方做小文件快读（笔记接口用） */
export function readTextIfExists(path: string, maxBytes = 512 * 1024): string | null {
  if (!existsSync(path)) return null;
  const st = statSync(path);
  if (!st.isFile()) return null;
  if (st.size > maxBytes) throw new Error(`文件过大（${st.size} 字节，上限 ${maxBytes}）：${path}`);
  return readFileSync(path, 'utf8');
}
