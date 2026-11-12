import { attachPersistent, sendRequest, type AttachHandle } from './client.js';
import { ensureDaemon } from './spawn.js';
import { deriveProjectName } from './paths.js';

/**
 * MCP server 启动时自动把 agent 的工作目录注册进 web。
 * 收益：agent 一行配置都不写就能在浏览器看到自己的设计稿。
 * 失败不阻断 MCP 服务（写 stderr 提示即返回 null）。
 * 可用 PAINTRESS_NO_AUTO_WEB=1 关闭。
 */

export interface AutoRegisterResult {
  handle: AttachHandle;
  project: string;
  startedDaemon: boolean;
}

export async function autoRegister(cwd: string = process.cwd()): Promise<AutoRegisterResult | null> {
  if (process.env['PAINTRESS_NO_AUTO_WEB'] === '1') return null;
  try {
    // idle 放宽到 1h：自动拉起的 daemon 生命周期跟 agent 会话对齐，而不是每次交互都拉起一次
    const { started } = await ensureDaemon({ idleTimeoutMs: 60 * 60_000 });
    const project = deriveProjectName(cwd);
    const watched = await sendRequest({ kind: 'watch', project, dir: cwd }, 8000);
    if (!watched.ok) throw new Error(watched.error);
    const handle = await attachPersistent(project);
    return { handle, project, startedDaemon: started };
  } catch (cause) {
    process.stderr.write(`paintress: web 自动注册失败（${cause instanceof Error ? cause.message : String(cause)}），MCP 工具不受影响\n`);
    return null;
  }
}
