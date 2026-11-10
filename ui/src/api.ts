/** 与 daemon 的 JSON API 契约（服务端见 src/web/daemon.ts） */

export interface ProjectInfo {
  name: string;
  root: string;
  depth: number;
  fileCount: number;
  agentConns: number;
  browserConns: number;
  lastAccess: number;
}

export interface ProjectsResponse {
  ok: boolean;
  projects: ProjectInfo[];
  pid?: number;
  uptimeMs?: number;
  version?: string;
}

export interface FilesResponse {
  ok: boolean;
  project: string;
  files: string[];
  depth: number;
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

export function fetchFiles(project: string): Promise<FilesResponse> {
  return getJson<FilesResponse>(`/api/projects/${encodeURIComponent(project)}/files`);
}

/** iframe 地址：daemon 直接返回带 data-node-id 的渲染 HTML */
export function renderUrl(project: string, file: string): string {
  return `/render/${encodeURIComponent(project)}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

/** SSE 地址：文件变更推送 */
export function eventsUrl(project: string, file: string): string {
  return `/events?project=${encodeURIComponent(project)}&path=${encodeURIComponent(file)}`;
}
