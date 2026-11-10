import chokidar, { type FSWatcher } from 'chokidar';

/**
 * 按需文件监听：只在有浏览器 SSE 连接时才 watch 该文件（引用计数）。
 * Linux inotify 递归 watch 会为每个子目录占一个 descriptor（默认上限 8192），
 * 因此绝不能watch整个项目——只 watch 正在查看的文件。
 */

type ChangeListener = (absPath: string) => void;

interface Entry {
  watcher: FSWatcher;
  refs: number;
  listeners: Set<ChangeListener>;
}

export class WatchManager {
  private readonly entries = new Map<string, Entry>();

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

  async closeAll(): Promise<void> {
    const all = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(all.map((e) => e.watcher.close()));
  }
}
