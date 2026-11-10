/**
 * 变更记录：AI 写完文件后，把受影响的节点 id 记下来，前端据此高亮。
 * 只存在 daemon 内存里，带 TTL（过期自动失效，避免刷新页面时旧高亮复活）。
 */

export interface ChangeSet {
  project: string;
  /** 相对项目根的文件路径，统一用 / */
  file: string;
  ids: string[];
  at: number;
}

/** 同一次操作内的多次写入合并窗口 */
const MERGE_WINDOW_MS = 1500;
/** 高亮有效期：超过则视为过期，前端不再展示 */
const TTL_MS = 60_000;

export class ChangesStore {
  private readonly byKey = new Map<string, ChangeSet>();

  private static key(project: string, file: string): string {
    return `${project}\u0000${file}`;
  }

  /** 记录一次变更；窗口期内合并 ids（避免一次 batch 产生多条记录） */
  record(project: string, file: string, ids: string[]): ChangeSet {
    const key = ChangesStore.key(project, file);
    const now = Date.now();
    const prev = this.byKey.get(key);
    if (prev && now - prev.at < MERGE_WINDOW_MS) {
      prev.ids = [...new Set([...prev.ids, ...ids])];
      prev.at = now;
      return prev;
    }
    const set: ChangeSet = { project, file, ids: [...new Set(ids)], at: now };
    this.byKey.set(key, set);
    return set;
  }

  /** 读取未过期的变更 */
  get(project: string, file: string): ChangeSet | undefined {
    const hit = this.byKey.get(ChangesStore.key(project, file));
    if (!hit) return undefined;
    if (Date.now() - hit.at > TTL_MS) return undefined;
    return hit;
  }

  clear(project: string): number {
    let n = 0;
    for (const [key, set] of this.byKey) {
      if (set.project === project) {
        this.byKey.delete(key);
        n += 1;
      }
    }
    return n;
  }

  /** 清理过期条目（由调用方按需触发，避免无限增长） */
  prune(): number {
    const now = Date.now();
    let n = 0;
    for (const [key, set] of this.byKey) {
      if (now - set.at > TTL_MS) {
        this.byKey.delete(key);
        n += 1;
      }
    }
    return n;
  }
}

export const CHANGE_TTL_MS = TTL_MS;
