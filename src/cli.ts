#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOOLS, type ToolOutput } from './mcp/tools.js';
import { runStdioServer } from './mcp/server.js';
import { startDaemon } from './web/daemon.js';
import { isDaemonRunning, sendRequest, attachPersistent } from './web/client.js';

/**
 * paintress CLI —— 与 MCP 共享同一套工具 handler。
 * 用法：
 *   paintress mcp                                    启动 stdio MCP server
 *   paintress info <file>
 *   paintress query <file> [--type t] [--name n] [--regex] [--id i] [--reusable]
 *   paintress get <file> <id> [--depth n]
 *   paintress update <file> <id> '<patch-json>'
 *   paintress insert <file> <parent> '<node-json>' [--index n]
 *   paintress delete <file> <id>
 *   paintress move <file> <id> <parent> [--index n]
 *   paintress batch <file> '<ops-json>'
 *   paintress render <file> <out.html>
 *   paintress shot <file> <out.png> [--scale n]
 *   paintress validate <file>
 *   paintress web [--port n] [--idle ms] [--daemon]   启动唯一 web 实例
 *   paintress ping                                    检查 web 是否在运行
 *   paintress status                                  查看已注册项目
 *   paintress watch <name> <dir>                      注册要跟踪的目录
 *   paintress unwatch <name>                          移除项目
 *   paintress attach <name>                           保持连接作为存活信号
 *   paintress stop                                    停止 web
 */

export interface ParsedCommand {
  cmd: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

const FLAG_KEYS = new Set(['type', 'name', 'regex', 'id', 'reusable', 'depth', 'index', 'scale', 'port', 'idle', 'daemon']);

/** 纯函数：argv → 命令 + 位置参数 + 标志（可单测） */
export function parseArgv(argv: string[]): ParsedCommand | null {
  const [cmd, ...rest] = argv;
  if (!cmd) return null;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i] as string;
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      if (!FLAG_KEYS.has(key)) return null; // 未知标志直接判非法
      const next = rest[i + 1];
      if (key === 'regex' || key === 'reusable') {
        flags[key] = true;
      } else if (typeof next === 'string' && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(tok);
    }
  }
  return { cmd, positionals, flags };
}

function flagStr(f: Record<string, string | boolean>, key: string): string | undefined {
  const v = f[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function flagNum(f: Record<string, string | boolean>, key: string): number | undefined {
  const v = flagStr(f, key);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${key} 需要非负整数，收到：${v}`);
  return n;
}

function parseJson<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new Error(`${what} 不是合法 JSON：${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

async function call(tool: string, args: Record<string, unknown>): Promise<ToolOutput> {
  const def = TOOLS[tool];
  if (!def) throw new Error(`未知工具：${tool}`);
  return await def.run(args);
}

/** 入口：返回退出码（可单测） */
export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv);
  if (!parsed) {
    console.error('用法：paintress <mcp|web|ping|status|watch|unwatch|attach|stop|info|query|get|update|insert|delete|move|batch|render|shot|validate> ...');
    return 2;
  }
  const { cmd, positionals, flags } = parsed;
  const [file, a1, a2] = positionals as (string | undefined)[];

  try {
    if (cmd === 'mcp') {
      await runStdioServer();
      return 0;
    }

    // ---- web 控制面（不需要 <file>）----
    if (cmd === 'ping') {
      if (!isDaemonRunning()) {
        console.log(JSON.stringify({ ok: false, running: false, hint: '未运行：paintress web --daemon' }));
        return 1;
      }
      const res = await sendRequest({ kind: 'ping' });
      console.log(JSON.stringify(res, null, 2));
      return res.ok ? 0 : 1;
    }
    if (cmd === 'status') {
      if (!isDaemonRunning()) {
        console.log(JSON.stringify({ ok: false, running: false }));
        return 1;
      }
      console.log(JSON.stringify(await sendRequest({ kind: 'status' }), null, 2));
      return 0;
    }
    if (cmd === 'watch') {
      if (!file || !a1) throw new Error('用法：paintress watch <name> <dir> [--depth 1..6]');
      const depth = flagNum(flags, 'depth');
      console.log(
        JSON.stringify(
          await sendRequest({ kind: 'watch', project: file, dir: a1, ...(depth !== undefined ? { depth } : {}) }, 8000),
          null,
          2,
        ),
      );
      return 0;
    }
    if (cmd === 'unwatch') {
      if (!file) throw new Error('用法：paintress unwatch <name>');
      console.log(JSON.stringify(await sendRequest({ kind: 'unwatch', project: file }), null, 2));
      return 0;
    }
    if (cmd === 'stop') {
      if (!isDaemonRunning()) {
        console.log(JSON.stringify({ ok: true, shutdown: true, already: true }));
        return 0;
      }
      console.log(JSON.stringify(await sendRequest({ kind: 'shutdown' }), null, 2));
      return 0;
    }
    if (cmd === 'attach') {
      if (!file) throw new Error('用法：paintress attach <name>');
      const handle = await attachPersistent(file);
      console.log(JSON.stringify({ ok: true, attached: true, project: file, note: '连接保持中，断开即视为退出' }));
      // 保持前台，直到被信号终止或被 daemon 关掉
      await new Promise<void>((resolve) => {
        handle.onClose(() => resolve());
        const bye = (): void => {
          handle.close();
          resolve();
        };
        process.once('SIGINT', bye);
        process.once('SIGTERM', bye);
      });
      return 0;
    }
    if (cmd === 'web') {
      const port = flagNum(flags, 'port');
      const idle = flagNum(flags, 'idle');
      if (flags['daemon'] === true) {
        const { spawn } = await import('node:child_process');
        const args = [process.argv[1] ?? '', 'web'];
        if (port !== undefined) args.push('--port', String(port));
        if (idle !== undefined) args.push('--idle', String(idle));
        const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
        child.unref();
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (isDaemonRunning()) {
            const res = await sendRequest({ kind: 'ping' });
            console.log(JSON.stringify({ daemon: true, launcherPid: child.pid, ...res }, null, 2));
            return 0;
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error('后台启动超时（5s 内未出现控制面 socket）');
      }
      const handle = await startDaemon({
        ...(port !== undefined ? { port } : {}),
        ...(idle !== undefined ? { idleTimeoutMs: idle } : {}),
      });
      console.log(JSON.stringify({ ok: true, pid: handle.pid, port: handle.port, http: `http://localhost:${handle.port}` }, null, 2));
      // 不返回：server 保持打开，事件循环非空 → 进程常驻
      await new Promise<void>((resolve) => {
        process.once('SIGINT', () => void handle.close().then(() => resolve()));
        process.once('SIGTERM', () => void handle.close().then(() => resolve()));
      });
      return 0;
    }

    if (!file) throw new Error('缺少 <file> 参数');

    let out: ToolOutput;
    switch (cmd) {
      case 'info':
        out = await call('paintress_doc_info', { path: file });
        break;
      case 'query':
        out = await call('paintress_query', {
          path: file,
          ...(flagStr(flags, 'type') !== undefined ? { type: flagStr(flags, 'type') } : {}),
          ...(flagStr(flags, 'name') !== undefined ? { name: flagStr(flags, 'name') } : {}),
          ...(flags['regex'] === true ? { nameRegex: true } : {}),
          ...(flagStr(flags, 'id') !== undefined ? { id: flagStr(flags, 'id') } : {}),
          ...(flags['reusable'] === true ? { reusable: true } : {}),
        });
        break;
      case 'get': {
        if (!a1) throw new Error('缺少 <id> 参数');
        out = await call('paintress_get', { path: file, id: a1, ...(flagNum(flags, 'depth') !== undefined ? { depth: flagNum(flags, 'depth') } : {}) });
        break;
      }
      case 'update': {
        if (!a1) throw new Error('缺少 <id> 参数');
        const patch = parseJson<Record<string, unknown>>(a2 ?? '', 'patch');
        out = await call('paintress_update', { path: file, id: a1, patch });
        break;
      }
      case 'insert': {
        if (!a1) throw new Error("缺少 <parent> 参数（节点 id 或 'root'）");
        const node = parseJson<Record<string, unknown>>(a2 ?? '', 'node');
        out = await call('paintress_insert', {
          path: file,
          parent: a1,
          node,
          ...(flagNum(flags, 'index') !== undefined ? { index: flagNum(flags, 'index') } : {}),
        });
        break;
      }
      case 'delete':
        if (!a1) throw new Error('缺少 <id> 参数');
        out = await call('paintress_delete', { path: file, id: a1 });
        break;
      case 'move':
        if (!a1 || !a2) throw new Error('缺少 <id> 或 <parent> 参数');
        out = await call('paintress_move', {
          path: file,
          id: a1,
          parent: a2,
          ...(flagNum(flags, 'index') !== undefined ? { index: flagNum(flags, 'index') } : {}),
        });
        break;
      case 'batch': {
        const ops = parseJson<unknown[]>(a1 ?? '', 'ops');
        out = await call('paintress_batch', { path: file, ops });
        break;
      }
      case 'validate':
        out = await call('paintress_validate', { path: file });
        break;
      case 'render': {
        if (!a1) throw new Error('缺少 <out.html> 参数');
        out = await call('paintress_render', { path: file, out: a1 });
        break;
      }
      case 'shot': {
        if (!a1) throw new Error('缺少 <out.png> 参数');
        out = await call('paintress_screenshot', {
          path: file,
          out: a1,
          ...(flagNum(flags, 'scale') !== undefined ? { scale: flagNum(flags, 'scale') } : {}),
        });
        break;
      }
      default:
        console.error(`未知子命令：${cmd}`);
        return 2;
    }
    console.log(JSON.stringify(out, null, 2));
    return 0;
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }
}

// 直接执行时（bin）启动；被 import 时不执行。
// 不能用 argv[1].endsWith('cli.js') 判断：npm 安装后的 bin 是指向 dist/cli.js 的符号链接，
// argv[1] 变成 `.../node_modules/.bin/paintress`，后缀匹配会失败 → 静默退出 0。
// 改用 realpath 比较：符号链接、`node dist/cli.js`、直接执行三种情况下都能正确识别。
function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  void main(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exitCode = code;
  });
}
