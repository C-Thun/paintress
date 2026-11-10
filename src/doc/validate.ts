import { DocumentSchema, KNOWN_NODE_TYPES, VARIABLE_NAME } from '../schema/index.js';
import { collectIds } from './id.js';

/** 校验结果：errors 阻断写入，warnings 不阻断 */
export type ValidationIssue = {
  level: 'error' | 'warning';
  path: string;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

/** 结构校验（schema）+ 语义校验（重复 id、悬空 ref、未知类型、未解析变量） */
export function validateDoc(input: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const parsed = DocumentSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        level: 'error',
        path: issue.path.length > 0 ? issue.path.map(String).join('/') : '<root>',
        message: issue.message,
      });
    }
    return { ok: false, errors, warnings };
  }
  const doc = parsed.data;

  // 重复 id
  const allIds = collectIds(doc.children);
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of allIds) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  for (const id of dup) {
    warnings.push({ level: 'warning', path: `<id:${id}>`, message: 'id 重复' });
  }

  // 悬空 ref 与未知节点类型
  const walk = (nodes: unknown[], path: string): void => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node || typeof node !== 'object') continue;
      const rec = node as Record<string, unknown>;
      const type = rec['type'];
      const here = `${path}/${i}`;
      if (typeof type === 'string' && !KNOWN_NODE_TYPES.includes(type as (typeof KNOWN_NODE_TYPES)[number])) {
        warnings.push({ level: 'warning', path: here, message: `未知节点类型 "${type}"，已原样保留` });
      }
      if (type === 'ref' && typeof rec['ref'] === 'string' && !seen.has(rec['ref'])) {
        warnings.push({ level: 'warning', path: here, message: `ref 指向不存在的组件 id "${String(rec['ref'])}"` });
      }
      const kids = rec['children'];
      if (Array.isArray(kids)) walk(kids, `${here}/children`);
    }
  };
  walk(doc.children, 'children');

  // 未解析变量引用（$name 不在 variables 表）
  const varNames = new Set(doc.variables ? Object.keys(doc.variables) : []);
  const varRefs = new Set<string>();
  const scan = (obj: unknown): void => {
    if (typeof obj === 'string' && VARIABLE_NAME.test(obj)) varRefs.add(obj.slice(1));
    else if (Array.isArray(obj)) obj.forEach(scan);
    else if (obj && typeof obj === 'object') Object.values(obj).forEach(scan);
  };
  scan(doc.children);
  for (const name of varRefs) {
    if (!varNames.has(name)) {
      warnings.push({ level: 'warning', path: '<variables>', message: `字段引用了未定义的变量 $${name}` });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
