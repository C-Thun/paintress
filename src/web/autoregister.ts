import { attachPersistent, sendRequest, type AttachHandle } from './client.js';
import { ensureDaemon } from './spawn.js';
import { deriveProjectName } from './paths.js';
import { openBrowser, projectUrl } from './open-browser.js';

/**
 * MCP server 启动时自动把 agent 的工作目录注册进 web。
 * 收益：agent 一行配置都不写就能在浏览器看到自己的设计稿。
 * 失败不阻断 MCP 服务（写 stderr 提示即返回 null）。
 * 可用 PAINTRESS_NO_AUTO_WEB=1 关闭自动注册，PAINTRESS_NO_OPEN=1 只关闭“自动开浏览器”。
 */

export interface AutoRegisterResult {
  handle: AttachHandle;
  project: string;
  startedDaemon: boolean;
  /** 本次是否真的把浏览器叫起来了（对已存在的 daemon 不重复开） */
  openedBrowser: boolean;
}

export async function autoRegister(cwd: string = process.cwd()): Promise<AutoRegisterResult | null> {
  if (process.env['PAINTRESS_NO_AUTO_WEB'] === '1') return null;
  try {
    // 不再写死 --idle：生命周期交给 daemon 自己算——有 agent attach 就活着，
    // 最后一个 agent 走后项目自动退场、进程随之收尾。
    const { started, port } = await ensureDaemon();
    const project = deriveProjectName(cwd);
    const watched = await sendRequest({ kind: 'watch', project, dir: cwd, owner: 'agent' }, 8000);
    if (!watched.ok) throw new Error(watched.error);
    const handle = await attachPersistent(project);
    // 只在「本次拉起 daemon」时开一次浏览器，并在项目看着没人看的情况下自动升级到该项目
    const openedBrowser = started && port !== undefined ? openBrowser(projectUrl(port, project)) : false;
    return { handle, project, startedDaemon: started, openedBrowser };
  } catch (cause) {
    process.stderr.write(`paintress: web 自动注册失败（${cause instanceof Error ? cause.message : String(cause)}），MCP 工具不受影响\n`);
    return null;
  }
}
