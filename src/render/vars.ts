import { VARIABLE_NAME, type PenDocument } from '../schema/index.js';

/** 变量解析：$name → variables 表取值（themed 列表取无主题项，缺省取首项）。决策 4：渲染时内联。 */

export type Warnings = string[];

/**
 * 主题上下文：节点的 `theme` 字段（如 `{mode:'dark', density:'compact'}`）
 * 沿子树继承，变量取对应主题的那一项。design 稿里同一份文件同时放
 * dark/compact 与 light/loose 两套画板，不认主题就全渲染成第一项的颜色与尺寸。
 */
export type ThemeContext = Record<string, string>;

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
  /** 当前主题上下文（只读，供诊断） */
  theme(): ThemeContext;
  /** 叠加一层节点主题，返回子作用域解析器（浅拷贝，代价很小） */
  withTheme(patch: Record<string, unknown> | undefined): VarResolver;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asVarValue(v: unknown): VarValue | undefined {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return undefined;
}

/**
 * themed 列表 → 按当前主题匹配。
 * 规则：主题键全匹配的条目优先（越具体的胜出），其次无主题项，最后首项。
 * 这样 `{value:'#202226', theme:{mode:'dark'}}` 在 dark 下胜出，
 * 而只写了 `{density:'loose'}` 的尺寸条目在 compact 下不会误命中。
 */
function resolveThemed(v: unknown, theme: ThemeContext): VarValue | undefined {
  if (Array.isArray(v)) {
    const entries = v.filter(isRecord);
    if (entries.length === 0) return undefined;
    let best: { entry: Record<string, unknown>; score: number } | null = null;
    for (const entry of entries) {
      const t = entry['theme'];
      if (t === undefined) {
        if (best === null) best = { entry, score: 0 };
        continue;
      }
      if (!isRecord(t)) continue;
      const keys = Object.keys(t);
      const hit = keys.every((k) => theme[k] === String(t[k]));
      if (!hit) continue;
      if (best === null || keys.length > best.score) best = { entry, score: keys.length };
    }
    return best === null ? asVarValue(entries[0]?.['value']) : asVarValue(best.entry['value']);
  }
  return asVarValue(v);
}

export function makeVarResolver(doc: PenDocument, warnings: Warnings, theme: ThemeContext = {}): VarResolver {
  const vars = doc.variables ?? {};

  // lookup 必须绑在「本次作用域」上：早期实现把它写在 make 外面，withTheme 换了 scope
  // 仍然按根主题查，于是子树的 light/loose 主题等于没生效（整份稿子都渲染成第一项）。
  const make = (scope: ThemeContext): VarResolver => {
    const lookup = (name: string): VarValue | undefined => {
      const def = vars[name];
      if (!isRecord(def)) return undefined;
      return resolveThemed(def['value'], scope);
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

      theme: () => scope,

      withTheme(patch: Record<string, unknown> | undefined): VarResolver {
        if (patch === undefined) return make(scope);
        const next: ThemeContext = { ...scope };
        for (const [k, v] of Object.entries(patch)) {
          if (typeof v === 'string') next[k] = v;
        }
        return make(next);
      },
    };
  };

  return make(theme);
}
