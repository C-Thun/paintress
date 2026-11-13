import { resolve } from 'node:path';
import { attachPersistent, queryDaemon, sendRequest, type AttachHandle } from './client.js';
import { ensureDaemon } from './spawn.js';
import { deriveProjectName, sanitizeProjectName } from './paths.js';
import { openBrowser, projectUrl } from './open-browser.js';

/**
 * 把 agent 的项目交给 web 查看器 —— **幂等**，可以每次都无条件调用。
 *
 * 「开始作画前先把 web 拉起来」是 agent 的默认动作（见 skills/paintress/SKILL.md 与
 * MCP server instructions），所以这条路径不能有副作用累积：
 * - daemon 已在跑 → 复用，不起第二个进程；
 * - 项目已注册且连接还活着 → 不再 watch/attach；
 * - 只有真的拉起 daemon 的那一次才开浏览器（避免每次调用都弹窗）。
 *
 * 可用 PAINTRESS_NO_AUTO_WEB=1 整体关闭。
 */

export interface ViewerInfo {
  project: string;
  pid: number;
  port: number;
  /** 人可以直接打开的地址（项目深链） */
  url: string;
  /** 本次调用是否真的拉起了 daemon */
  startedDaemon: boolean;
  /** 本次调用是否真的把浏览器叫起来了 */
  openedBrowser: boolean;
}

export interface EnsureViewerOptions {
  /** 要注册的目录，默认当前工作目录；相对路径按本进程 cwd 解析（daemon 的 cwd 不可信） */
  dir?: string;
  /** 项目名，默认由目录推导（父目录/自身） */
  project?: string;
  /** 列举设计稿的最大深度（1..6，默认 3） */
  depth?: number;
}

/**
 * 每个项目的 attach 连接必须被持有：daemon 用「连接是否还在」判定 agent 是否活着。
 * 连接一断，agent 自动注册的项目会在宽限期后退场。
 */
const handles = new Map<string, AttachHandle>();

/** 进程退出时释放连接（daemon 立刻看到 agent 走了，比等 OS 回收快） */
export function closeViewerHandles(): void {
  for (const handle of handles.values()) {
    try {
      handle.close();
    } catch {
      /* 已断开 */
    }
  }
  handles.clear();
}

function autoWebDisabled(): boolean {
  return process.env['PAINTRESS_NO_AUTO_WEB'] === '1';
}

/** 幂等入口：确保 daemon 在跑、项目已注册、本进程持有存活连接，返回可分享的 URL */
export async function ensureViewer(opts: EnsureViewerOptions = {}): Promise<ViewerInfo> {
  if (autoWebDisabled()) {
    throw new Error('PAINTRESS_NO_AUTO_WEB=1：已关闭自动查看器，需要手动运行 paintress web');
  }
  const dir = resolve(opts.dir ?? process.cwd());
  const project = opts.project !== undefined ? sanitizeProjectName(opts.project) : deriveProjectName(dir);

  const running = await queryDaemon();
  const attached = handles.get(project);
  if (running !== null && attached !== undefined && !attached.isClosed()) {
    // 快速路径：daemon 活着、连接也活着 → 什么都不做（每次写操作都会走这里）
    return {
      project,
      pid: running.pid,
      port: running.port,
      url: projectUrl(running.port, project),
      startedDaemon: false,
      openedBrowser: false,
    };
  }

  const { started, pid, port } = await ensureDaemon();
  const watched = await sendRequest(
    { kind: 'watch', project, dir, owner: 'agent', ...(opts.depth !== undefined ? { depth: opts.depth } : {}) },
    8000,
  );
  if (!watched.ok) throw new Error(watched.error);

  // 同项目重复注册：旧连接（daemon 重启后必然已死）先放掉，避免 daemon 误判 agent 数量
  attached?.close();
  handles.set(project, await attachPersistent(project));

  // 只在「本次拉起 daemon」时开一次浏览器，并直接落在自己的项目上
  const openedBrowser = started && openBrowser(projectUrl(port, project));
  return { project, pid, port, url: projectUrl(port, project), startedDaemon: started, openedBrowser };
}

/**
 * MCP server 启动时自动注册自身（best-effort，失败不阻断 MCP）。
 * 与 ensureViewer 同一条路径 —— 启动时注册和「开始画之前补一次」是同一件事。
 */
export async function autoRegister(cwd: string = process.cwd()): Promise<ViewerInfo | null> {
  if (autoWebDisabled()) return null;
  try {
    return await ensureViewer({ dir: cwd });
  } catch (cause) {
    process.stderr.write(
      `paintress: web 自动注册失败（${cause instanceof Error ? cause.message : String(cause)}），MCP 工具不受影响\n`,
    );
    return null;
  }
}
