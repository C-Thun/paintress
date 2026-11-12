/**
 * 多客户端接入（阶段 5）：把「paintress mcp」这条 stdio 命令写进各家 agent 的配置。
 *
 * 设计要点：
 * - 只认「已知客户端 + 已知路径」，不做全盘扫描；
 * - 生成条目与写入分离：解析/生成是纯函数（可单测），落盘只在 apply 阶段发生；
 * - 路径由 home / platform / env 注入，测试不依赖真实文件系统。
 */

import { dirname } from 'node:path';

export type ClientId = 'claude' | 'cursor' | 'vscode' | 'windsurf' | 'codex' | 'pi' | 'opencode';

/** 条目的命令写法：分开的 command+args，还是合并成 command 数组（OpenCode） */
export type CommandForm = 'command+args' | 'command-array';

export type OpenCodeLayout = 'auto' | 'legacy' | 'v2';

export interface ClientSpec {
  id: ClientId;
  label: string;
  format: 'json' | 'toml';
  /** JSON 配置里存放 server 表的路径；OpenCode 会按已有文件在两种布局间切换 */
  rootPath: string[];
  /** 条目里需要显式写出的 type 值（VS Code: stdio / OpenCode: local） */
  typeValue?: string;
  commandForm?: CommandForm;
  /** 条目里的固定附加字段（OpenCode 旧布局需要 enabled: true） */
  extraFields?: Record<string, unknown>;
  /** 配置文件绝对路径 */
  configPath(home: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string;
}

const posixHome = (home: string): string => home.replace(/\/+$/, '');

export const CLIENTS: readonly ClientSpec[] = [
  {
    id: 'claude',
    label: 'Claude Desktop',
    format: 'json',
    rootPath: ['mcpServers'],
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
    rootPath: ['mcpServers'],
    configPath: (home) => `${posixHome(home)}/.cursor/mcp.json`,
  },
  {
    id: 'vscode',
    label: 'VS Code',
    format: 'json',
    rootPath: ['servers'],
    typeValue: 'stdio',
    configPath: (home, platform, env) => {
      if (platform === 'darwin') return `${posixHome(home)}/Library/Application Support/Code/User/mcp.json`;
      if (platform === 'win32') return `${env['APPDATA'] ?? posixHome(home)}/Code/User/mcp.json`;
      return `${posixHome(home)}/.config/Code/User/mcp.json`;
    },
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    format: 'json',
    rootPath: ['mcpServers'],
    configPath: (home, platform, env) => {
      const dir = platform === 'win32' ? (env['USERPROFILE'] ?? posixHome(home)) : posixHome(home);
      return `${dir}/.codeium/windsurf/mcp_config.json`;
    },
  },
  {
    id: 'codex',
    label: 'Codex',
    format: 'toml',
    rootPath: ['mcp_servers'],
    configPath: (home) => `${posixHome(home)}/.codex/config.toml`,
  },
  {
    id: 'pi',
    label: 'pi',
    format: 'json',
    rootPath: ['mcpServers'],
    configPath: (home) => `${posixHome(home)}/.pi/agent/mcp.json`,
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    format: 'json',
    // V2 放在 mcp.servers 下；旧布局直接放在 mcp 下，由 resolveRootPath 按已有文件决定
    rootPath: ['mcp', 'servers'],
    typeValue: 'local',
    commandForm: 'command-array',
    configPath: (home, _platform, env) => {
      const base = env['XDG_CONFIG_HOME'] ?? `${posixHome(home)}/.config`;
      return `${base}/opencode/opencode.json`;
    },
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

/** 单个客户端的配置条目；OpenCode 旧布局还需要 enabled: true */
export function buildEntry(
  spec: ClientSpec,
  launch: LaunchCommand,
  layout: OpenCodeLayout = 'auto',
): Record<string, unknown> {
  const entry: Record<string, unknown> = {};
  if (spec.typeValue !== undefined) entry['type'] = spec.typeValue;
  if (spec.commandForm === 'command-array') entry['command'] = [launch.command, ...launch.args];
  else {
    entry['command'] = launch.command;
    entry['args'] = launch.args;
  }
  if (spec.extraFields !== undefined) Object.assign(entry, spec.extraFields);
  if (spec.id === 'opencode' && layout === 'legacy') entry['enabled'] = true;
  return entry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 解析 server 表在配置里的路径。
 *
 * OpenCode 有两套布局：V2 把 server 放在 `mcp.servers` 下，旧布局直接放在 `mcp` 下。
 * 已有文件按实际内容判断（避免把条目写到当前版本不读的位置），新文件用官方当前的 V2。
 */
export function resolveRootPath(
  spec: ClientSpec,
  existingRoot: Record<string, unknown> | null,
  layout: OpenCodeLayout = 'auto',
): string[] {
  if (spec.id !== 'opencode') return spec.rootPath;
  if (layout === 'legacy') return ['mcp'];
  if (layout === 'v2') return ['mcp', 'servers'];
  const mcp = existingRoot?.['mcp'];
  if (isRecord(mcp)) {
    if (isRecord(mcp['servers'])) return ['mcp', 'servers'];
    const looksLikeServers = Object.values(mcp).some(
      (v) => isRecord(v) && (typeof v['type'] === 'string' || 'command' in v),
    );
    if (looksLikeServers) return ['mcp'];
  }
  return ['mcp', 'servers'];
}

/** Codex 用的 TOML 片段（改 TOML 风险高，只输出不写入） */
export function tomlSnippet(launch: LaunchCommand, name = 'paintress'): string {
  // JSON 字符串转义与 TOML 基本字符串兼容；Windows 路径中的反斜杠必须转义。
  const args = launch.args.map((a) => JSON.stringify(a)).join(', ');
  return `[mcp_servers.${name}]\ncommand = ${JSON.stringify(launch.command)}\nargs = [${args}]\n`;
}

/** JSON 客户端用的片段（含嵌套路径，OpenCode 按默认布局） */
export function jsonSnippet(spec: ClientSpec, launch: LaunchCommand, name = 'paintress'): string {
  const path = resolveRootPath(spec, null);
  const entry = buildEntry(spec, launch, path.length === 1 ? 'legacy' : 'v2');
  const nested: Record<string, unknown> = { [name]: entry };
  let cursor: Record<string, unknown> = nested;
  for (const key of [...path].reverse()) cursor = { [key]: cursor };
  return JSON.stringify(cursor, null, 2);
}
