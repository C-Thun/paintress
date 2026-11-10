import { schemaForType, type PenDocument, type PenNode } from '../schema/index.js';
import { genId, collectIds } from '../doc/id.js';

/**
 * 操作层：全部作用于内存中的文档对象（纯函数式，不碰文件系统）。
 * 约定：除 batch 外均为就地修改（mutation）；batch 在克隆上执行，失败即整体作废。
 */

type AnyNode = Record<string, unknown>;

export interface NodeRef {
  node: AnyNode;
  parent: AnyNode | null; // null = 文档根
  /** 从根到本节点的 name/type 路径，供展示 */
  path: string;
}

/** 建立 id → 节点索引（O(n) 一次遍历） */
export function buildIndex(doc: PenDocument): Map<string, NodeRef> {
  const index = new Map<string, NodeRef>();
  const label = (n: AnyNode): string =>
    typeof n['name'] === 'string' && n['name'] ? String(n['name']) : `${String(n['type'] ?? '?')}#${String(n['id'] ?? '?')}`;

  const walk = (children: unknown[], parent: AnyNode | null, prefix: string): void => {
    for (const child of children) {
      if (!child || typeof child !== 'object') continue;
      const node = child as AnyNode;
      const path = prefix ? `${prefix} / ${label(node)}` : label(node);
      const id = node['id'];
      if (typeof id === 'string') index.set(id, { node, parent, path });
      const kids = node['children'];
      if (Array.isArray(kids)) walk(kids, node, path);
    }
  };
  walk(doc.children, null, '');
  return index;
}

function childrenOf(container: AnyNode | null, doc: PenDocument): unknown[] {
  return container === null ? doc.children : ((container['children'] as unknown[]) ?? []);
}

function setChildren(container: AnyNode | null, doc: PenDocument, kids: unknown[]): void {
  if (container === null) doc.children = kids as PenDocument['children'];
  else container['children'] = kids;
}

export interface QueryFilter {
  type?: string;
  /** 精确名或正则（传 /re/ 形式字符串，如 "^Tab"） */
  name?: string;
  nameRegex?: boolean;
  id?: string;
  reusable?: boolean;
}

export interface QueryHit {
  id: string;
  name?: string;
  type: string;
  path: string;
}

export function query(doc: PenDocument, filter: QueryFilter): QueryHit[] {
  const index = buildIndex(doc);
  const re = filter.name && filter.nameRegex ? new RegExp(filter.name) : null;
  const hits: QueryHit[] = [];
  for (const [id, ref] of index) {
    const node = ref.node;
    if (filter.type !== undefined && node['type'] !== filter.type) continue;
    if (filter.id !== undefined && id !== filter.id) continue;
    if (filter.reusable !== undefined && Boolean(node['reusable']) !== filter.reusable) continue;
    if (filter.name !== undefined) {
      const name = typeof node['name'] === 'string' ? node['name'] : '';
      if (re ? !re.test(name) : name !== filter.name) continue;
    }
    hits.push({
      id,
      name: typeof node['name'] === 'string' ? node['name'] : undefined,
      type: String(node['type'] ?? '?'),
      path: ref.path,
    });
  }
  return hits;
}

export type GetResult = {
  node: unknown;
  /** 子树是否因 depth 被截断 */
  truncated: boolean;
};

/** 取单节点子树；depth=0 只取本节点，children 以 [...] 标记省略 */
export function get(doc: PenDocument, id: string, depth = Infinity): GetResult | null {
  const index = buildIndex(doc);
  const ref = index.get(id);
  if (!ref) return null;
  let truncated = false;
  const copy = (node: AnyNode, d: number): AnyNode => {
    const out: AnyNode = { ...node };
    const kids = out['children'];
    if (Array.isArray(kids)) {
      if (d <= 0) {
        out['children'] = ['…'];
        truncated = true;
      } else {
        out['children'] = kids.map((k) => (k && typeof k === 'object' ? copy(k as AnyNode, d - 1) : k));
      }
    }
    return out;
  };
  return { node: copy(ref.node, depth), truncated };
}

export interface UpdateResult {
  changed: string[];
}

/** 浅合并更新节点属性。id 与 type 不可通过 update 改变。 */
export function update(doc: PenDocument, id: string, patch: Record<string, unknown>): UpdateResult {
  const index = buildIndex(doc);
  const ref = index.get(id);
  if (!ref) throw new Error(`节点不存在：${id}`);
  if ('id' in patch && patch['id'] !== id) throw new Error('禁止通过 update 修改 id');
  if ('type' in patch && patch['type'] !== ref.node['type']) throw new Error('禁止通过 update 修改 type（用 replace 语义）');
  const changed: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (ref.node[k] !== v) {
      ref.node[k] = v;
      changed.push(k);
    }
  }
  return { changed };
}

/** 插入子节点。缺 id 先生成再校验；已知类型走严格 schema，未知类型宽松透传；返回新节点 id。 */
export function insert(doc: PenDocument, parentId: string | 'root', node: unknown, index?: number): string {
  if (!node || typeof node !== 'object') throw new Error('插入节点必须是对象');
  const draft = { ...(node as Record<string, unknown>) };
  const type = draft['type'];
  if (typeof type !== 'string') throw new Error('插入节点缺少 type 字段');
  const taken = new Set(collectIds(doc.children));
  if (typeof draft['id'] !== 'string' || draft['id'] === '') {
    draft['id'] = genId(taken);
  } else if (taken.has(String(draft['id']))) {
    throw new Error(`id 已存在：${String(draft['id'])}`);
  }
  const parsed = schemaForType(type).safeParse(draft);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`插入节点不合法：${first ? `${first.path.map(String).join('/')}: ${first.message}` : '未知错误'}`);
  }
  const target = parsed.data as AnyNode;
  let container: AnyNode | null = null;
  if (parentId !== 'root') {
    const idx = buildIndex(doc).get(parentId);
    if (!idx) throw new Error(`父节点不存在：${parentId}`);
    if (!Array.isArray(idx.node['children'])) idx.node['children'] = [];
    container = idx.node;
  }
  const kids = [...childrenOf(container, doc)];
  if (index === undefined) {
    kids.push(target);
  } else {
    if (index < 0 || index > kids.length) throw new Error(`index 越界：${index}`);
    kids.splice(index, 0, target);
  }
  setChildren(container, doc, kids);
  return String(target['id']);
}

/** 删除节点（含子树）。返回被删除的节点。 */
export function remove(doc: PenDocument, id: string): PenNode {
  const index = buildIndex(doc);
  const ref = index.get(id);
  if (!ref) throw new Error(`节点不存在：${id}`);
  const container = ref.parent;
  const kids = childrenOf(container, doc).filter((k) => !(k && typeof k === 'object' && (k as AnyNode)['id'] === id));
  setChildren(container, doc, kids);
  return ref.node as PenNode;
}

/** 移动/重排：把节点挂到新父（或根）下指定位置。 */
export function move(doc: PenDocument, id: string, newParentId: string | 'root', index?: number): void {
  if (newParentId === id) throw new Error('不能把节点移动到自己下面');
  const indexMap = buildIndex(doc);
  const ref = indexMap.get(id);
  if (!ref) throw new Error(`节点不存在：${id}`);
  // 防环：newParent 不能在 id 的子树里
  let ancestor: AnyNode | null = newParentId === 'root' ? null : (indexMap.get(newParentId)?.node ?? null);
  while (ancestor !== null) {
    if (ancestor['id'] === id) throw new Error('不能把节点移动到它自己的子树下（会成环）');
    const next = indexMap.get(String(ancestor['id']))?.parent ?? null;
    if (next === null) break;
    ancestor = next;
  }
  const node = remove(doc, id);
  try {
    insert(doc, newParentId, node, index);
  } catch (cause) {
    // 回滚：放回原位
    insert(doc, ref.parent ? String(ref.parent['id']) : 'root', node);
    throw new Error(`移动失败已回滚：${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

export type BatchOp =
  | { op: 'update'; id: string; patch: Record<string, unknown> }
  | { op: 'insert'; parent: string | 'root'; node: unknown; index?: number }
  | { op: 'delete'; id: string }
  | { op: 'move'; id: string; parent: string | 'root'; index?: number };

/** 批量原子操作：在深克隆上顺序执行，任一步失败整体作废，返回新文档。 */
export function batch(doc: PenDocument, ops: BatchOp[]): PenDocument {
  const clone = structuredClone(doc);
  let i = 0;
  for (const op of ops) {
    try {
      switch (op.op) {
        case 'update':
          update(clone, op.id, op.patch);
          break;
        case 'insert':
          insert(clone, op.parent, structuredClone(op.node), op.index);
          break;
        case 'delete':
          remove(clone, op.id);
          break;
        case 'move':
          move(clone, op.id, op.parent, op.index);
          break;
      }
    } catch (cause) {
      throw new Error(`batch 第 ${i} 步（${op.op}）失败，整体未生效：${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
    i++;
  }
  return clone;
}
