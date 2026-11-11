/**
 * 配置写入：解析 → 合并 → 备份 → 原子落盘。
 * 只动 `rootKey` 下名为 `paintress` 的那一条，其余内容与顺序保持不变（JSON 重新序列化）。
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildEntry, tomlSnippet, type ClientSpec, type LaunchCommand } from './clients.js';

export type PlanStatus = 'create' | 'update' | 'noop' | 'invalid';

export interface InstallPlan {
  spec: ClientSpec;
  path: string;
  status: PlanStatus;
  /** 目标文件内容（invalid 时为 null） */
  next: string | null;
  /** 人类可读的说明 */
  detail: string;
}

/** 纯函数：把 paintress 条目并入现有配置文本 */
export function planJsonMerge(
  spec: ClientSpec,
  path: string,
  existing: string | null,
  launch: LaunchCommand,
): InstallPlan {
  const base: InstallPlan = { spec, path, status: 'noop', next: null, detail: '' };

  if (spec.format === 'toml') {
    const snippet = tomlSnippet(launch);
    if (existing === null) return { ...base, status: 'create', next: snippet, detail: '将创建配置文件并写入条目' };
    // 允许已有的引号表名与点两侧空白；否则追加同一个逻辑表会生成非法 TOML。
    if (/^\s*\[\s*mcp_servers\s*\.\s*(?:paintress|"paintress"|'paintress')\s*\]\s*$/m.test(existing)) {
      return { ...base, status: 'noop', detail: '条目已存在（TOML 不自动改写）' };
    }
    const next = `${existing.replace(/\s*$/, '')}\n\n${snippet}`;
    return { ...base, status: 'update', next, detail: '将追加条目（TOML 只追加，不改写既有内容）' };
  }

  let root: Record<string, unknown> = {};
  if (existing !== null && existing.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ...base, status: 'invalid', detail: '配置文件不是 JSON 对象，未改动' };
      }
      root = parsed as Record<string, unknown>;
    } catch {
      return { ...base, status: 'invalid', detail: '配置文件不是合法 JSON，未改动' };
    }
  }

  const servers = root[spec.rootKey];
  const table: Record<string, unknown> =
    typeof servers === 'object' && servers !== null && !Array.isArray(servers)
      ? { ...(servers as Record<string, unknown>) }
      : {};
  const entry = buildEntry(spec, launch);
  const current = table['paintress'];
  if (JSON.stringify(current) === JSON.stringify(entry)) {
    return { ...base, status: 'noop', next: JSON.stringify(root, null, 2) + '\n', detail: '条目已是最新' };
  }
  const existed = current !== undefined;
  table['paintress'] = entry;
  root[spec.rootKey] = table;
  return {
    ...base,
    status: existed ? 'update' : existing === null ? 'create' : 'update',
    next: JSON.stringify(root, null, 2) + '\n',
    detail: existed ? '将更新已有条目' : '将新增条目',
  };
}

/** 写入（可 dryRun）：先备份再原子替换 */
export function applyPlan(path: string, content: string, dryRun: boolean): { backup: string | null } {
  if (dryRun) return { backup: null };
  mkdirSync(dirname(path), { recursive: true });
  let backup: string | null = null;
  if (existsSync(path)) {
    backup = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(path, backup);
  }
  const tmp = join(dirname(path), `.paintress-tmp-${process.pid}`);
  writeFileSync(tmp, content, 'utf8');
  // rename 会替换 inode；不保留 mode 会把 0600 的含凭据配置放宽成 0644。
  if (existsSync(path)) chmodSync(tmp, statSync(path).mode & 0o777);
  renameSync(tmp, path);
  return { backup };
}

/** 读取（不存在返回 null） */
export function readConfig(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
