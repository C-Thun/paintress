import { readFileSync, writeFileSync, renameSync, copyFileSync, statSync, mkdirSync, linkSync, unlinkSync } from 'node:fs';
import { VERSION } from '../shared/version.js';
import { basename, dirname, join } from 'node:path';
import { DocumentSchema, X_PAINTRESS_KEY, PTR_SPEC_VERSION, type PenDocument } from '../schema/index.js';
import { validateDoc, type ValidationResult } from './validate.js';

export type DocFlavor = 'pen' | 'ptr';

export interface LoadedDoc {
  doc: PenDocument;
  flavor: DocFlavor;
  /** 读入时的 mtime（ms）。保存时传入以防并发覆盖。 */
  mtimeMs: number;
  /** 结构校验 + 语义警告 */
  validation: ValidationResult;
}

const GENERATOR = `paintress/${VERSION}`;

export class FileChangedError extends Error {
  constructor(public readonly path: string) {
    super(`文件在读入后被其他程序修改，拒绝覆盖：${path}`);
    this.name = 'FileChangedError';
  }
}

/** 探测格式风味：.ptr 扩展名或含 x-paintress 键 → ptr */
function detectFlavor(path: string, raw: Record<string, unknown>): DocFlavor {
  if (path.endsWith('.ptr')) return 'ptr';
  if (X_PAINTRESS_KEY in raw) return 'ptr';
  return 'pen';
}

/** 读入并校验。JSON 语法错误与结构错误直接抛出（带文件上下文）；语义问题进 validation.warnings。 */
export function loadDoc(path: string): LoadedDoc {
  const text = readFileSync(path, 'utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new Error(`JSON 解析失败（${path}）：${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`文档根必须是对象：${path}`);
  }
  const doc = DocumentSchema.parse(raw);
  const mtimeMs = statSync(path).mtimeMs;
  return {
    doc,
    flavor: detectFlavor(path, raw as Record<string, unknown>),
    mtimeMs,
    validation: validateDoc(doc),
  };
}

export interface SaveOptions {
  /** 期望的文件 mtime（来自 loadDoc）。不一致则抛 FileChangedError */
  expectedMtimeMs?: number;
  /** 只创建新文件：目标已存在时拒绝（用于 paintress_new 的跨进程覆盖保护） */
  createOnly?: boolean;
  /** 备份目录；默认 /tmp/ptr-backup-<epoch> */
  backupDir?: string;
  /** 覆盖默认风味推断（如另存为 .ptr） */
  flavor?: DocFlavor;
}

/**
 * 原子保存：备份 → 临时文件 → fsync → rename。
 * flavor=ptr 时注入/刷新 x-paintress（spec=1 必填，见 format/spec.yaml §ptr）。
 */
export function saveDoc(path: string, doc: PenDocument, opts: SaveOptions = {}): number {
  if (opts.expectedMtimeMs !== undefined) {
    let current: number;
    try {
      current = statSync(path).mtimeMs;
    } catch {
      current = -1; // 目标不存在（新建文件），放行
    }
    if (current !== opts.expectedMtimeMs) throw new FileChangedError(path);
  }

  const flavor: DocFlavor = opts.flavor ?? (path.endsWith('.ptr') ? 'ptr' : 'pen');
  const out: Record<string, unknown> = { ...doc };
  if (flavor === 'ptr') {
    const prev = (out[X_PAINTRESS_KEY] ?? {}) as Record<string, unknown>;
    out[X_PAINTRESS_KEY] = {
      ...prev,
      spec: PTR_SPEC_VERSION,
      generator: GENERATOR,
      updated_at: new Date().toISOString(),
      ...(prev['created_at'] ? { created_at: prev['created_at'] } : { created_at: new Date().toISOString() }),
    };
  }

  // 备份已存在的目标
  try {
    statSync(path);
    const dir = opts.backupDir ?? `/tmp/ptr-backup-${Math.floor(Date.now() / 1000)}`;
    mkdirSync(dir, { recursive: true });
    copyFileSync(path, join(dir, basename(path)));
  } catch {
    // 目标不存在（新建），无需备份；备份失败不阻断写入
  }

  const text = JSON.stringify(out, null, 2);
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}`);
  writeFileSync(tmp, text, 'utf8');
  if (opts.createOnly) {
    // link(2) 原子创建：即使另一个进程恰好在 existsSync 之后写入，也不会覆盖它。
    // 临时文件与目标同目录，文件系统支持硬链接；不先 touch 目标，避免留下空文件。
    try {
      linkSync(tmp, path);
    } catch (cause) {
      try {
        unlinkSync(tmp);
      } catch {
        /* 清理失败不影响原始错误 */
      }
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`文件已存在，拒绝覆盖：${path}`);
      }
      throw cause;
    }
    unlinkSync(tmp);
  } else {
    renameSync(tmp, path);
  }
  return statSync(path).mtimeMs;
}

/** round-trip 序列化（不落盘）：用于 diff、快照与测试 */
export function serializeDoc(doc: PenDocument): string {
  return JSON.stringify(doc, null, 2);
}
