/**
 * 多客户端接入（阶段 5）：把「paintress mcp」这条 stdio 命令写进各家 agent 的配置。
 *
 * 设计要点：
 * - 只认「已知客户端 + 已知路径」，不做全盘扫描；
 * - 生成条目与写入分离：解析/生成是纯函数（可单测），落盘只在 apply 阶段发生；
 * - 路径由 home / platform / env 注入，测试不依赖真实文件系统。
 */

import { dirname } from 'node:path';

export type ClientId = 'claude' | 'cursor' | 'vscode' | 'codex' | 'pi';

export interface ClientSpec {
  id: ClientId;
  label: string;
  format: 'json' | 'toml';
  /** JSON 配置的顶层键：Claude/Cursor/pi 用 mcpServers，VS Code 用 servers */
  rootKey: string;
  /** VS Code 的条目需要显式 type: 'stdio' */
  needsType: boolean;
  /** 配置文件绝对路径 */
  configPath(home: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string;
}

const posixHome = (home: string): string => home.replace(/\/+$/, '');

export const CLIENTS: readonly ClientSpec[] = [
  {
    id: 'claude',
    label: 'Claude Desktop',
    format: 'json',
    rootKey: 'mcpServers',
    needsType: false,
    configPath: (home, platform, env) => {
      if (platform === 'darwin') return `${posixHome(home)}/Library/Application Support/Claude/claude_desktop_config.json`;
      if (platform === 'win32') return `${env['APPDATA'] ?? posixHome(home)}/Claude/claude_desktop_config.json`;
      return `${posixHome(home)}/.config/Claude/claude_desktop_config.json`;
    },
  },
  {
    id: 'cursor',
    label: 'Cursor',
    format: 'json',
    rootKey: 'mcpServers',
    needsType: false,
    configPath: (home) => `${posixHome(home)}/.cursor/mcp.json`,
  },
  {
    id: 'vscode',
    label: 'VS Code',
    format: 'json',
    rootKey: 'servers',
    needsType: true,
    configPath: (home, platform, env) => {
      if (platform === 'darwin') return `${posixHome(home)}/Library/Application Support/Code/User/mcp.json`;
      if (platform === 'win32') return `${env['APPDATA'] ?? posixHome(home)}/Code/User/mcp.json`;
      return `${posixHome(home)}/.config/Code/User/mcp.json`;
    },
  },
  {
    id: 'codex',
    label: 'Codex',
    format: 'toml',
    rootKey: 'mcp_servers',
    needsType: false,
    configPath: (home) => `${posixHome(home)}/.codex/config.toml`,
  },
  {
    id: 'pi',
    label: 'pi',
    format: 'json',
    rootKey: 'mcpServers',
    needsType: false,
    configPath: (home) => `${posixHome(home)}/.pi/agent/mcp.json`,
  },
];

export function findClient(id: string): ClientSpec | undefined {
  return CLIENTS.find((c) => c.id === id);
}

/**
 * 客户端是否已在本机出现过：配置目录存在即视为已安装/已使用。
 * 不依赖可执行文件是否在 PATH（GUI 客户端通常不在 PATH），也不扫全盘。
 */
export function isClientDetected(
  spec: ClientSpec,
  home: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean,
): boolean {
  const path = spec.configPath(home, platform, env);
  return exists(path) || exists(dirname(path));
}

export interface LaunchCommand {
  command: string;
  args: string[];
}

/**
 * 决定写进配置的启动命令。
 *
 * - 若 `paintress` 已经在 PATH 上指向当前可执行文件（全局安装的常见情形）→ 用裸命令，
 *   这样 node 版本切换、包升级后配置不会失效；
 * - 否则回退到当前脚本的绝对路径（本地/npx 场景）。
 */
export function resolveLaunchCommand(opts: {
  scriptPath: string;
  pathEnv: string | undefined;
  platform: NodeJS.Platform;
  exists: (path: string) => boolean;
  realpath: (path: string) => string;
}): LaunchCommand {
  const { scriptPath, pathEnv, platform, exists, realpath } = opts;
  const exts = platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  let self: string;
  try {
    self = realpath(scriptPath);
  } catch {
    self = scriptPath;
  }
  for (const dir of (pathEnv ?? '').split(platform === 'win32' ? ';' : ':')) {
    if (dir === '') continue;
    for (const ext of exts) {
      const candidate = `${dir.replace(/[\\/]+$/, '')}/paintress${ext}`;
      if (!exists(candidate)) continue;
      try {
        // Windows 的 .cmd 垫片不是同一文件，退化为「同名即可」
        if (platform === 'win32' || realpath(candidate) === self) {
          return { command: 'paintress', args: ['mcp'] };
        }
      } catch {
        /* 继续找 */
      }
    }
  }
  return { command: self, args: ['mcp'] };
}

/** 单个客户端的配置条目 */
export function buildEntry(spec: ClientSpec, launch: LaunchCommand): Record<string, unknown> {
  const base: Record<string, unknown> = { command: launch.command, args: launch.args };
  return spec.needsType ? { type: 'stdio', ...base } : base;
}

/** Codex 用的 TOML 片段（改 TOML 风险高，只输出不写入） */
export function tomlSnippet(launch: LaunchCommand, name = 'paintress'): string {
  // JSON 字符串转义与 TOML 基本字符串兼容；Windows 路径中的反斜杠必须转义。
  const args = launch.args.map((a) => JSON.stringify(a)).join(', ');
  return `[mcp_servers.${name}]\ncommand = ${JSON.stringify(launch.command)}\nargs = [${args}]\n`;
}

/** JSON 客户端用的片段（含顶层键） */
export function jsonSnippet(spec: ClientSpec, launch: LaunchCommand, name = 'paintress'): string {
  return JSON.stringify({ [spec.rootKey]: { [name]: buildEntry(spec, launch) } }, null, 2);
}
