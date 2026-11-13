import type { Mark } from './marks.js';

/** 控制面协议：CLI ↔ daemon（Unix socket，换行分隔 JSON） */

export type ClientRequest =
  | { kind: 'ping' }
  | { kind: 'status' }
  | { kind: 'watch'; project: string; dir: string; depth?: number; owner?: 'agent' | 'manual' }
  | { kind: 'unwatch'; project: string }
  | { kind: 'attach'; project: string }
  | { kind: 'detach'; project: string }
  | { kind: 'marks'; project: string }
  | { kind: 'mark'; project: string; nodeId: string; name?: string; type?: string; path?: string }
  | { kind: 'clear-marks'; project: string }
  | { kind: 'changes'; path: string; ids: string[] }
  | { kind: 'shutdown' };

export interface ProjectInfo {
  name: string;
  /** 人看的展示名（与目录一致的两级路径）；缺省时前端回退到 name */
  label: string;
  root: string;
  /** 列举设计稿的最大目录深度（默认 3，上限 6） */
  depth: number;
  fileCount: number;
  agentConns: number;
  browserConns: number;
  lastAccess: number;
}

export type ServerResponse =
  | { ok: true; pid: number; uptimeMs: number; projects: ProjectInfo[]; version: string }
  | { ok: true; project: ProjectInfo }
  | { ok: true; attached: true; project: string }
  | { ok: true; detached: true; project: string }
  | { ok: true; watched: true; project: ProjectInfo }
  | { ok: true; unwatched: boolean }
  | { ok: true; pong: true; pid: number; port: number; uptimeMs: number; projects: number }
  | { ok: true; marks: Mark[] }
  | { ok: true; mark: Mark }
  | { ok: true; cleared: number }
  | { ok: true; recorded: number }
  | { ok: true; shutdown: true }
  | { ok: false; error: string };

export function encodeLine(msg: ClientRequest | ServerResponse): string {
  return `${JSON.stringify(msg)}\n`;
}

/** 逐行解析器：处理流式分片，容忍尾部不完整行 */
export class LineDecoder {
  private buf = '';

  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    for (;;) {
      const idx = this.buf.indexOf('\n');
      if (idx < 0) break;
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (line.trim() !== '') out.push(line);
    }
    return out;
  }
}
