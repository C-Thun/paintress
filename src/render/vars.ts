import { VARIABLE_NAME, type PenDocument } from '../schema/index.js';

/** 变量解析：$name → variables 表取值（themed 列表取无主题项，缺省取首项）。决策 4：渲染时内联。 */

export type Warnings = string[];

/** 变量值域：字面量（themed 条目解包后同此） */
export type VarValue = string | number | boolean;

export interface VarResolver {
  /** $ref 解析为具体值；非 $ 开头原样返回；解析失败返回原串并记警告 */
  resolve(input: string): string;
  /** 数字或 $变量 → 数值；非法/缺省 → undefined（记警告） */
  resolveNum(input: unknown): number | undefined;
  /** 布尔或 $变量 → 布尔；非法/缺省 → undefined */
  resolveBool(input: unknown): boolean | undefined;
  has(name: string): boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asVarValue(v: unknown): VarValue | undefined {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return undefined;
}

/** themed 列表 → 无主题项优先，否则首项；字面量直通 */
function resolveThemed(v: unknown): VarValue | undefined {
  if (Array.isArray(v)) {
    const entries = v.filter(isRecord);
    const plain = entries.find((e) => e['theme'] === undefined) ?? entries[0];
    return plain ? asVarValue(plain['value']) : undefined;
  }
  return asVarValue(v);
}

export function makeVarResolver(doc: PenDocument, warnings: Warnings): VarResolver {
  const vars = doc.variables ?? {};
  const lookup = (name: string): VarValue | undefined => {
    const def = vars[name];
    if (!isRecord(def)) return undefined;
    return resolveThemed(def['value']);
  };
  return {
    resolve(input: string): string {
      // 只有形如 $name 的才是变量引用；普通文本（如“$5 起”）原样返回
      if (!VARIABLE_NAME.test(input)) return input;
      const val = lookup(input.slice(1));
      if (val === undefined) {
        warnings.push(`未定义变量 ${input}，按原样输出`);
        return input;
      }
      return String(val);
    },
    resolveNum(input: unknown): number | undefined {
      if (typeof input === 'number') return input;
      if (typeof input === 'string') {
        if (!VARIABLE_NAME.test(input)) {
          const n = Number(input);
          return Number.isFinite(n) ? n : undefined;
        }
        const val = lookup(input.slice(1));
        if (typeof val === 'number') return val;
        warnings.push(`数字变量 ${input} 解析失败，按缺省处理`);
        return undefined;
      }
      return undefined;
    },
    resolveBool(input: unknown): boolean | undefined {
      if (typeof input === 'boolean') return input;
      if (typeof input === 'string') {
        if (!VARIABLE_NAME.test(input)) return input === 'true';
        const val = lookup(input.slice(1));
        if (typeof val === 'boolean') return val;
        warnings.push(`布尔变量 ${input} 解析失败，按缺省处理`);
        return undefined;
      }
      return undefined;
    },
    has(name: string): boolean {
      return lookup(name) !== undefined;
    },
  };
}
