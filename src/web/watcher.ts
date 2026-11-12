import chokidar, { type FSWatcher } from 'chokidar';
import { extname, relative, sep } from 'node:path';
import { DESIGN_EXT } from './registry.js';

/**
 * 按需文件监听：正在查看的文件有浏览器 SSE 连接时才 watch（引用计数）。
 * 注册表另有 design 目录监听：chokidar 按目录排除规则与深度过滤，
 * 不把 node_modules / .git 等无关目录纳入 watch，避免耗尽 inotify 配额。
 */

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '.venv', 'venv', '__pycache__']);

export interface DesignWatchHandle {
  /** 初次扫描完成，可以开始断言后续文件变更 */
  ready: Promise<void>;
  close(): Promise<void>;
}

interface DesignWatchEntry extends DesignWatchHandle {
  depth: number;
}

type ChangeListener = (absPath: string) => void;

/** 与 Registry.listDesigns 同一套列举边界：隐藏项、构建目录、深度、扩展名 */
function designIgnored(root: string, depth: number, path: string, stats?: { isDirectory(): boolean }): boolean {
  if (path === root) return false;
  const parts = relative(root, path).split(sep).filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.some((part) => part.startsWith('.') || IGNORED_DIRS.has(part))) return true;
  // 目录层级与文件层级不同：depth=1 时允许 nested/x.ptr（文件路径两段），
  // 但不递归进 nested/deep/（目录路径两段）。
  const maxParts = stats?.isDirectory() === true ? depth : depth + 1;
  if (parts.length > maxParts) return true;
  if (stats?.isDirectory() === true) return false;
  // chokidar 会对已允许的目录再以 stats=undefined 复查；此时无扩展名仍可能是目录，不能忽略。
  // 普通文件由下面的 add/unlink 监听器再次按扩展名过滤。
  if (stats === undefined && extname(path) === '') return false;
  return !DESIGN_EXT.has(extname(path).toLowerCase());
}

interface Entry {
  watcher: FSWatcher;
  refs: number;
  listeners: Set<ChangeListener>;
}

export class WatchManager {
  private readonly entries = new Map<string, Entry>();
  private readonly designs = new Map<string, DesignWatchEntry>();

  /** 取得对某文件的监听；返回释放函数 */
  acquire(absPath: string, onChange: ChangeListener): () => void {
    let entry = this.entries.get(absPath);
    if (!entry) {
      const watcher = chokidar.watch(absPath, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
        persistent: true,
      });
      const listeners = new Set<ChangeListener>();
      const created: Entry = { watcher, refs: 0, listeners };
      watcher.on('change', () => {
        for (const cb of created.listeners) cb(absPath);
      });
      watcher.on('unlink', () => {
        for (const cb of created.listeners) cb(absPath);
      });
      entry = created;
      this.entries.set(absPath, entry);
    }
    entry.refs += 1;
    entry.listeners.add(onChange);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const cur = this.entries.get(absPath);
      if (!cur) return;
      cur.listeners.delete(onChange);
      cur.refs -= 1;
      if (cur.refs <= 0) {
        this.entries.delete(absPath);
        void cur.watcher.close();
      }
    };
  }

  /** 当前被监听的文件数（诊断用） */
  size(): number {
    return this.entries.size;
  }

  /**
   * 项目设计稿目录监听：仅 .ptr / .pen 的增删会触发，且遵守项目扫描深度。
   * 相同 root + depth 重复调用复用同一 watcher；depth 变化时重建。
   */
  watchDesigns(root: string, depth: number, onChange: ChangeListener): DesignWatchHandle {
    const existing = this.designs.get(root);
    if (existing?.depth === depth) return existing;
    if (existing) void existing.close();

    const watcher = chokidar.watch(root, {
      ignoreInitial: true,
      ignored: (path, stats) => designIgnored(root, depth, path, stats),
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
      persistent: true,
    });
    const ready = new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
    const handle: DesignWatchEntry = {
      depth,
      ready,
      close: async () => {
        if (this.designs.get(root) === handle) this.designs.delete(root);
        await watcher.close();
      },
    };
    const onDesignChange = (file: string): void => {
      if (DESIGN_EXT.has(extname(file).toLowerCase())) onChange(file);
    };
    this.designs.set(root, handle);
    watcher.on('add', onDesignChange);
    watcher.on('unlink', onDesignChange);
    watcher.on('unlinkDir', onChange);
    watcher.on('error', () => void handle.close());
    return handle;
  }

  unwatchDesigns(root: string): void {
    void this.designs.get(root)?.close();
  }

  async closeAll(): Promise<void> {
    const all = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(all.map((e) => e.watcher.close()));
    await Promise.all([...this.designs.values()].map((d) => d.close()));
  }
}
