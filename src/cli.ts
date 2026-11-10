#!/usr/bin/env node
import { TOOLS, type ToolOutput } from './mcp/tools.js';
import { runStdioServer } from './mcp/server.js';

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
 */

export interface ParsedCommand {
  cmd: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

const FLAG_KEYS = new Set(['type', 'name', 'regex', 'id', 'reusable', 'depth', 'index', 'scale']);

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
    console.error('用法：paintress <mcp|info|query|get|update|insert|delete|move|batch|validate> ...');
    return 2;
  }
  const { cmd, positionals, flags } = parsed;
  const [file, a1, a2] = positionals as (string | undefined)[];

  try {
    if (cmd === 'mcp') {
      await runStdioServer();
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

// 直接执行时（bin）启动；被 import 时不执行
const isDirect = process.argv[1]?.endsWith('cli.js') || process.argv[1]?.endsWith('cli.ts');
if (isDirect) {
  void main(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exitCode = code;
  });
}
