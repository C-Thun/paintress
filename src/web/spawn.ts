import { spawn } from 'node:child_process';
import { daemonPid, queryDaemon, type DaemonInfo } from './client.js';

/**
 * 拉起后台 daemon（唯一实例）。
 *
 * **幂等**：已经在跑就直接返回它的 pid/端口，绝不起第二个进程。
 * 这条保证是「agent 想画就先把 web 拉起来」的前提 —— 调用方可以每次都无条件调用。
 * 并发启动也安全：单实例锁保证只有一个 daemon 活下来，输掉竞争的一方复用它。
 */

export interface EnsureDaemonResult {
  /** 本次调用是否真的拉起了进程（false = 复用了已有的 daemon） */
  started: boolean;
  pid: number;
  /** 监听端口（来自 daemon 自己，端口冲突/自定义端口时也准确） */
  port: number;
}

export interface EnsureDaemonOptions {
  port?: number;
  idleTimeoutMs?: number;
  /** 拉起进程时不自动打开浏览器（CI、远程、只想拿 URL 给人） */
  noOpen?: boolean;
}

const START_TIMEOUT_MS = 6000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 复用已在运行的 daemon；显式指定了端口且与运行中的不一致时抛错
 * （幂等不等于「悄悄忽略你的参数」：要换端口得先 `paintress stop`）。
 */
export async function reuseDaemon(port?: number): Promise<DaemonInfo | null> {
  const info = await queryDaemon();
  if (info === null) return null;
  if (port !== undefined && port !== info.port) {
    throw new Error(
      `paintress web 已在运行（pid ${info.pid}，端口 ${info.port}），与请求的端口 ${port} 不同；如需换端口请先 paintress stop`,
    );
  }
  return info;
}

/** 启动超时的诊断信息：区分「进程没起来」与「进程在但控制面不通」 */
function timeoutHint(): string {
  const pid = daemonPid();
  if (pid !== null) {
    try {
      process.kill(pid, 0);
      return `；进程 ${pid} 仍在运行但控制面无响应，先运行 paintress stop（或 kill ${pid}）后重试`;
    } catch {
      /* 进程已死：锁/端口残留，重试一次通常就过 */
    }
  }
  return '；可能是锁或端口残留，先 paintress ping 看状态，或前台跑 paintress web 看报错';
}

export async function ensureDaemon(opts: EnsureDaemonOptions = {}): Promise<EnsureDaemonResult> {
  const running = await reuseDaemon(opts.port);
  if (running !== null) return { started: false, pid: running.pid, port: running.port };

  const entry = process.argv[1];
  if (!entry) throw new Error('无法确定 CLI 入口路径，不能后台启动 daemon');
  const args = [entry, 'web'];
  if (opts.port !== undefined) args.push('--port', String(opts.port));
  if (opts.idleTimeoutMs !== undefined) args.push('--idle', String(opts.idleTimeoutMs));
  if (opts.noOpen === true) args.push('--no-open');

  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
  child.unref();
  // 子进程失败（端口被占、锁被活进程占着）时它会自己退出：早发现比等满超时好
  let exitCode: number | null = null;
  child.once('exit', (code) => {
    exitCode = code;
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const info = await queryDaemon(500);
    if (info !== null) {
      // 端口按 daemon 自己报的为准：并发启动时输掉竞争的可能是我们这个子进程
      if (opts.port !== undefined && info.port !== opts.port) {
        throw new Error(`daemon 起在端口 ${info.port} 而不是请求的 ${opts.port}；先 paintress stop 再重试`);
      }
      return { started: true, pid: info.pid, port: info.port };
    }
    if (exitCode !== null) {
      throw new Error(`后台 daemon 启动失败（退出码 ${exitCode}）${timeoutHint()}`);
    }
    await sleep(100);
  }
  throw new Error(`后台启动 daemon 超时（${START_TIMEOUT_MS}ms）${timeoutHint()}`);
}
