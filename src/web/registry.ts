import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { ProjectInfo } from './protocol.js';
import { resolveProjectDir, sanitizeProjectName } from './paths.js';

/**
 * 项目注册表（daemon 内存态）。
 * - attach 用「连接」而非 PID：连接断开即 agent 死亡（OS 保证），无需轮询
 * - 每项目独立 socket 集合，idle 判定综合 agent 与浏览器连接
 */

export interface ProjectEntry {
  name: string;
  root: string;
  rootReal: string;
  /** agent 连接（attach），断开即移除 */
  agents: Set<symbol>;
  /** 浏览器 SSE 连接 */
  browsers: Set<symbol>;
  lastAccess: number;
  createdAt: number;
}

export const DESIGN_EXT = new Set(['.ptr', '.pen']);

export class Registry {
  private readonly projects = new Map<string, ProjectEntry>();

  /** 注册（或复用）项目目录；同名不同目录视为冲突 */
  watch(projectNameRaw: string, dir: string): ProjectEntry {
    const name = sanitizeProjectName(projectNameRaw);
    const { root, rootReal } = resolveProjectDir(dir);
    const existing = this.projects.get(name);
    if (existing) {
      if (existing.rootReal !== rootReal) {
        throw new Error(`项目名 "${name}" 已被 ${existing.root} 占用，请换一个名字（--name）`);
      }
      existing.lastAccess = Date.now();
      return existing;
    }
    const entry: ProjectEntry = {
      name,
      root,
      rootReal,
      agents: new Set(),
      browsers: new Set(),
      lastAccess: Date.now(),
      createdAt: Date.now(),
    };
    this.projects.set(name, entry);
    return entry;
  }

  get(name: string): ProjectEntry | undefined {
    return this.projects.get(sanitizeProjectName(name));
  }

  remove(name: string): boolean {
    return this.projects.delete(sanitizeProjectName(name));
  }

  all(): ProjectEntry[] {
    return [...this.projects.values()];
  }

  /** 列出项目内设计稿相对路径（浅层递归，跳过隐藏与依赖目录） */
  listDesigns(entry: ProjectEntry, maxDepth = 6): string[] {
    const out: string[] = [];
    const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '.venv', 'venv', '__pycache__']);
    const walk = (dir: string, rel: string, depth: number): void => {
      if (depth > maxDepth) return;
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of entries.sort((a, b) => a.localeCompare(b))) {
        if (name.startsWith('.')) continue;
        const abs = join(dir, name);
        let st;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        const relPath = rel === '' ? name : `${rel}/${name}`;
        if (st.isDirectory()) {
          if (skip.has(name)) continue;
          walk(abs, relPath, depth + 1);
        } else if (DESIGN_EXT.has(extname(name).toLowerCase())) {
          out.push(relPath);
        }
      }
    };
    walk(entry.rootReal, '', 0);
    return out;
  }

  info(entry: ProjectEntry): ProjectInfo {
    return {
      name: entry.name,
      root: entry.root,
      fileCount: this.listDesigns(entry).length,
      agentConns: entry.agents.size,
      browserConns: entry.browsers.size,
      lastAccess: entry.lastAccess,
    };
  }

  /** 存活判定：有 agent 或浏览器连接即活跃 */
  isIdle(entry: ProjectEntry): boolean {
    return entry.agents.size === 0 && entry.browsers.size === 0;
  }
}
