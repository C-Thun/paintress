import { spawn } from 'node:child_process';
import { isDaemonRunning, sendRequest } from './client.js';

/** 拉起后台 daemon（唯一实例）。已运行则直接返回。 */

export interface EnsureDaemonResult {
  started: boolean;
  pid?: number;
  /** 监听端口（已知时给出，用于拼接浏览器地址） */
  port?: number;
}

const START_TIMEOUT_MS = 6000;
const DEFAULT_PORT = 3316;

export async function ensureDaemon(opts: { port?: number; idleTimeoutMs?: number } = {}): Promise<EnsureDaemonResult> {
  if (isDaemonRunning()) {
    const res = await sendRequest({ kind: 'ping' });
    if (res.ok && 'pong' in res) return { started: false, pid: res.pid, port: opts.port ?? DEFAULT_PORT };
    // socket 在但连不上 → 视为残留，继续尝试重启
  }

  const entry = process.argv[1];
  if (!entry) throw new Error('无法确定 CLI 入口路径，不能后台启动 daemon');
  const args = [entry, 'web'];
  if (opts.port !== undefined) args.push('--port', String(opts.port));
  if (opts.idleTimeoutMs !== undefined) args.push('--idle', String(opts.idleTimeoutMs));

  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
  child.unref();

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isDaemonRunning()) {
      const res = await sendRequest({ kind: 'ping' });
      if (res.ok && 'pong' in res) return { started: true, pid: res.pid, port: opts.port ?? DEFAULT_PORT };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`后台启动 daemon 超时（${START_TIMEOUT_MS}ms）`);
}
