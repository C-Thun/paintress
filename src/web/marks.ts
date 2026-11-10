import type { Mark, MarkInput } from '../shared/api-types.js';

/**
 * 会话级标记：点击节点 → 分配短号 #1 #2 …，供对话中指代。
 * 只存在 daemon 内存里，daemon 退出即清空（跨会话作废，避免编号漂移改错东西）。
 * 类型定义在 src/shared/api-types.ts（前后端共用）。
 */

export type { Mark, MarkInput };

export class MarksStore {
  private readonly byProject = new Map<string, Map<string, Mark>>();
  private seq = 0;

  /** 同一项目内同一 nodeId 复用既有短号；否则分配新号 */
  add(input: MarkInput): Mark {
    let bucket = this.byProject.get(input.project);
    if (!bucket) {
      bucket = new Map();
      this.byProject.set(input.project, bucket);
    }
    const existing = bucket.get(input.nodeId);
    if (existing) {
      // 名称/路径可能随编辑变化，刷新元信息但保留短号
      if (input.name !== undefined) existing.name = input.name;
      if (input.type !== undefined) existing.type = input.type;
      if (input.path !== undefined) existing.path = input.path;
      existing.at = Date.now();
      return existing;
    }
    this.seq += 1;
    const mark: Mark = {
      shortId: this.seq,
      project: input.project,
      nodeId: input.nodeId,
      name: input.name,
      type: input.type,
      path: input.path ?? input.nodeId,
      at: Date.now(),
    };
    bucket.set(input.nodeId, mark);
    return mark;
  }

  list(project: string): Mark[] {
    const bucket = this.byProject.get(project);
    return bucket ? [...bucket.values()].sort((a, b) => a.shortId - b.shortId) : [];
  }

  get(project: string, nodeId: string): Mark | undefined {
    return this.byProject.get(project)?.get(nodeId);
  }

  clear(project: string): number {
    const bucket = this.byProject.get(project);
    if (!bucket) return 0;
    const n = bucket.size;
    this.byProject.delete(project);
    return n;
  }

  remove(project: string, nodeId: string): boolean {
    return this.byProject.get(project)?.delete(nodeId) ?? false;
  }
}
