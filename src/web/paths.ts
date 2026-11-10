import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

/** 运行期文件位置：默认 ~/.paintress/；可用 PAINTRESS_HOME 覆盖（测试隔离用） */
export function runtimeDir(): string {
  const dir = process.env['PAINTRESS_HOME'] ?? join(homedir(), '.paintress');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function socketPath(): string {
  return join(runtimeDir(), 'web.sock');
}

export function lockPath(): string {
  return join(runtimeDir(), 'web.lock');
}

export function pidPath(): string {
  return join(runtimeDir(), 'web.pid');
}

/** 项目名：URL 安全（字母数字点下划线连字符），冲突时加短 hash 后缀 */
export function sanitizeProjectName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+/, '');
  return cleaned === '' ? 'project' : cleaned;
}

/**
 * 由目录推导默认项目名：`父目录/自身`（适配 repos/<org>/<project> 结构）。
 * 均为 URL 安全字符；保留两级可读性。
 */
export function deriveProjectName(dir: string): string {
  const abs = resolve(dir);
  const parent = basename(dirname(abs));
  const self = basename(abs);
  const raw = parent && parent !== '/' ? `${parent}/${self}` : self;
  // 用 '-' 连接，避免 '/' 进入 URL 路径段造成歧义
  return sanitizeProjectName(raw.replace(/\//g, '-'));
}

export interface ResolvedDir {
  root: string;
  rootReal: string;
}

/** 校验并解析注册目录：必须存在且是目录；返回真实路径（供穿越校验基准） */
export function resolveProjectDir(dir: string): ResolvedDir {
  const abs = resolve(dir);
  if (!existsSync(abs)) throw new Error(`目录不存在：${abs}`);
  if (!statSync(abs).isDirectory()) throw new Error(`不是目录：${abs}`);
  return { root: abs, rootReal: realpathSync(abs) };
}

/**
 * 路径穿越防护：把请求路径解析为真实绝对路径，并确认它仍在项目根内。
 * 失败返回 null（调用方回 404，不泄露真实路径）。
 */
export function safeJoin(projectRootReal: string, requestPath: string): string | null {
  // 拒绝编码后的可疑片段（调用方应已 decode，这里再兜一层）
  if (requestPath.includes('\0')) return null;
  const normalized = requestPath.replace(/^\/+/, '');
  const target = resolve(join(projectRootReal, normalized));
  // 先做纯字符串 containment（防 ../ 直接跳出）
  const relStr = relative(projectRootReal, target);
  if (relStr === '' || relStr.startsWith('..') || relStr.includes(`..${sep}`)) return null;
  if (!existsSync(target)) return null;
  let real: string;
  try {
    real = realpathSync(target);
  } catch {
    return null;
  }
  // 再校验真实路径（防符号链接跳出）
  const relReal = relative(projectRootReal, real);
  if (relReal.startsWith('..') || relReal === '') return null;
  return real;
}
