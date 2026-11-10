import type { PenDocument, PenNode } from '../schema/index.js';
import type { Warnings } from './vars.js';

/**
 * ref 展开（决策 5）：渲染前在内存中把组件实例展开为完整子树，不改文件。
 * - ref 自身属性（ref/descendants/type 除外）→ 覆写组件根
 * - descendants 无 type 键 → 浅合并到目标后代
 * - descendants 有 type 键 → 整体替换该后代
 * - 嵌套实例：先递归展开，再应用 descendants 路径（a/b 指 a 实例内的 b）
 * - 环与悬空 ref → 紫色占位框 + 警告
 */

type AnyNode = Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function brokenRefPlaceholder(refNode: AnyNode, reason: string, warnings: Warnings): AnyNode {
  warnings.push(reason);
  return {
    type: 'rectangle',
    id: typeof refNode['id'] === 'string' ? refNode['id'] : 'broken',
    name: typeof refNode['name'] === 'string' ? refNode['name'] : 'Broken ref',
    width: 120,
    height: 40,
    fill: '#FF00FF',
    cornerRadius: 4,
    metadata: { type: 'paintress.broken-ref' },
  };
}

/** 收集 id → 节点索引（在原始树上找组件定义） */
function indexById(children: unknown[]): Map<string, AnyNode> {
  const map = new Map<string, AnyNode>();
  const walk = (nodes: unknown[]): void => {
    for (const n of nodes) {
      if (!isRecord(n)) continue;
      const id = n['id'];
      if (typeof id === 'string') map.set(id, n);
      const kids = n['children'];
      if (Array.isArray(kids)) walk(kids);
    }
  };
  walk(children);
  return map;
}

/** 在（已展开的）子树里按 id 路径定位节点；返回其父容器与命中节点 */
function findByPath(root: AnyNode, segments: string[]): { parent: AnyNode; node: AnyNode } | null {
  let container = root;
  let found: AnyNode | null = null;
  for (const seg of segments) {
    const kids = container['children'];
    if (!Array.isArray(kids)) return null;
    found = kids.find((k): k is AnyNode => isRecord(k) && k['id'] === seg) ?? null;
    if (!found) return null;
    container = found;
  }
  return found ? { parent: container, node: found } : null;
}

function applyDescendants(expandedRoot: AnyNode, descendants: Record<string, unknown>, warnings: Warnings, refId: string): void {
  for (const [path, overrideRaw] of Object.entries(descendants)) {
    if (!isRecord(overrideRaw)) continue;
    const segments = path.split('/').filter((s) => s !== '');
    const hit = findByPath(expandedRoot, segments);
    if (!hit) {
      warnings.push(`ref ${refId} 的 descendants 路径 "${path}" 未命中，已忽略`);
      continue;
    }
    if ('type' in overrideRaw) {
      // 整体替换：新树继承原位置 id（保持路径稳定性）
      const replacement = structuredClone(overrideRaw) as AnyNode;
      if (typeof replacement['id'] !== 'string') replacement['id'] = hit.node['id'];
      const kids = hit.parent['children'];
      if (Array.isArray(kids)) {
        const idx = kids.indexOf(hit.node);
        if (idx >= 0) kids[idx] = replacement;
      }
    } else {
      Object.assign(hit.node, structuredClone(overrideRaw));
    }
  }
}

/** 递归展开一个节点（就地修改克隆树） */
function expandNode(node: AnyNode, index: Map<string, AnyNode>, stack: Set<string>, warnings: Warnings): AnyNode {
  const kids = node['children'];
  if (Array.isArray(kids)) {
    node['children'] = kids.map((k) => (isRecord(k) ? expandNode(k, index, stack, warnings) : k));
  }
  if (node['type'] !== 'ref') return node;

  const refId = typeof node['id'] === 'string' ? node['id'] : '?';
  const target = typeof node['ref'] === 'string' ? node['ref'] : '';
  const component = index.get(target);
  if (!component) {
    return brokenRefPlaceholder(node, `ref ${refId} 指向不存在的组件 "${target}"`, warnings);
  }
  if (stack.has(target)) {
    return brokenRefPlaceholder(node, `ref ${refId} 展开成环（组件链回到 "${target}"），已截断`, warnings);
  }

  stack.add(target);
  try {
    // 展开组件克隆（含嵌套 ref）
    const clone = structuredClone(component) as AnyNode;
    clone['id'] = node['id']; // 实例根用实例自己的 id
    if (typeof node['name'] === 'string') clone['name'] = node['name'];
    if (Array.isArray(clone['children'])) {
      clone['children'] = (clone['children'] as unknown[]).map((k) => (isRecord(k) ? expandNode(k, index, stack, warnings) : k));
    }
    // ref 自身覆写（排除保留键）
    for (const [k, v] of Object.entries(node)) {
      if (k === 'type' || k === 'ref' || k === 'descendants' || k === 'id' || k === 'name') continue;
      clone[k] = structuredClone(v);
    }
    // descendants 在完全展开后应用
    const desc = node['descendants'];
    if (isRecord(desc)) applyDescendants(clone, desc, warnings, refId);
    return clone;
  } finally {
    stack.delete(target);
  }
}

/** 展开整棵文档树（深克隆，不改动原 doc） */
export function expandRefs(doc: PenDocument, warnings: Warnings): PenNode[] {
  const index = indexById(doc.children);
  // SAFETY: structuredClone 产出与原树同构的深拷贝；PenNode 均为对象，
  // Record<string, unknown> 视图对读/写已知键是完备的（后续按需取值时逐个收窄）。
  const cloned = structuredClone(doc.children) as unknown as AnyNode[];
  // SAFETY: expandNode 只做键合并/替换/克隆，产物仍是 schema 已验证过的节点形态
  // （调用方在文档层已过 DocumentSchema 校验），故可安全地回转 PenNode[]。
  return cloned.map((n) => expandNode(n, index, new Set(), warnings)) as unknown as PenNode[];
}
