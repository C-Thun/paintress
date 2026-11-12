/** 与 daemon 的 JSON API 契约（服务端见 src/web/daemon.ts） */

import type { Mark, MarkInput } from '../../src/shared/api-types.js';

export type { Mark, MarkInput };

export interface ProjectInfo {
  name: string;
  root: string;
  depth: number;
  fileCount: number;
  agentConns: number;
  browserConns: number;
  lastAccess: number;
}

export interface DaemonInfo {
  pid?: number;
  version?: string;
  /** npm 上的最新版本号（daemon 后台探测；离线/未开启时为 null） */
  latest?: string | null;
  /** agent attach + 设计稿 SSE + 项目列表 SSE 的长连接总数 */
  connections?: number;
}

export interface ProjectsResponse extends DaemonInfo {
  ok: boolean;
  projects: ProjectInfo[];
  uptimeMs?: number;
}

export interface DaemonInfoResponse extends DaemonInfo {
  ok: boolean;
}

export interface FilesResponse {
  ok: boolean;
  project: string;
  files: string[];
  depth: number;
}

export interface MarksResponse {
  ok: boolean;
  marks: Mark[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return (await res.json()) as T;
}

export function fetchProjects(): Promise<ProjectsResponse> {
  return getJson<ProjectsResponse>('/api/projects');
}

/** 轻量轮询：只取版本与连接数，不触发项目目录扫描 */
export function fetchDaemonInfo(): Promise<DaemonInfoResponse> {
  return getJson<DaemonInfoResponse>('/api/version');
}

export function fetchFiles(project: string): Promise<FilesResponse> {
  return getJson<FilesResponse>(`/api/projects/${encodeURIComponent(project)}/files`);
}

/** iframe 地址：daemon 返回带 data-node-id 的渲染 HTML；embed=1 时不自刷新（由父页面管 SSE） */
export function renderUrl(project: string, file: string): string {
  return `/render/${encodeURIComponent(project)}/${file.split('/').map(encodeURIComponent).join('/')}?embed=1`;
}

/** SSE 地址：文件变更推送 */
export function eventsUrl(project: string, file: string): string {
  return `/events?project=${encodeURIComponent(project)}&path=${encodeURIComponent(file)}`;
}

/** SSE 地址：注册表通道（不传项目）——项目增删、目录里新增设计稿时推 projects 事件 */
export function registryEventsUrl(): string {
  return '/events';
}

export function fetchMarks(project: string): Promise<MarksResponse> {
  return getJson<MarksResponse>(`/api/marks?project=${encodeURIComponent(project)}`);
}

export async function addMark(input: MarkInput): Promise<Mark> {
  const res = await fetch('/api/marks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { ok: boolean; mark: Mark; error?: string };
  if (!body.ok) throw new Error(body.error ?? '添加标记失败');
  return body.mark;
}

export async function clearMarks(project: string): Promise<number> {
  const res = await fetch(`/api/marks?project=${encodeURIComponent(project)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { ok: boolean; cleared: number };
  return body.cleared;
}

/** 破坏性写接口：daemon 要求自定义头 `x-paintress: 1`（跨站请求会触发预检，daemon 不应答预检） */
const WRITE_HEADERS = { 'x-paintress': '1' };

export async function unwatchProject(name: string): Promise<boolean> {
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE', headers: WRITE_HEADERS });
  const body = (await res.json()) as { ok: boolean; unwatched?: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.unwatched === true;
}

/** 关掉 daemon；返回 daemon 报告的连接数（用于二次确认文案） */
export async function shutdownDaemon(): Promise<number> {
  const res = await fetch('/api/shutdown', { method: 'POST', headers: WRITE_HEADERS });
  const body = (await res.json()) as { ok: boolean; connections?: number; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.connections ?? 0;
}

export interface ChangesResponse {
  ok: boolean;
  ids: string[];
  at: number;
}

/** 最近一次写操作影响到的节点 id（用于变更高亮） */
export function fetchChanges(project: string, file: string): Promise<ChangesResponse> {
  return getJson<ChangesResponse>(
    `/api/changes?project=${encodeURIComponent(project)}&path=${encodeURIComponent(file)}`,
  );
}
