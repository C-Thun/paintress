import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildEntry,
  findClient,
  jsonSnippet,
  resolveLaunchCommand,
  tomlSnippet,
  type ClientSpec,
  type LaunchCommand,
} from '../src/integrations/clients.js';
import { applyPlan, planJsonMerge, readConfig } from '../src/integrations/install.js';

const claude = findClient('claude') as ClientSpec;
const vscode = findClient('vscode') as ClientSpec;
const codex = findClient('codex') as ClientSpec;
const PI = findClient('pi') as ClientSpec;

const launch: LaunchCommand = { command: 'paintress', args: ['mcp'] };

describe('客户端路径解析', () => {
  it('linux：按 XDG 约定', () => {
    expect(claude.configPath('/home/u', 'linux', {})).toBe('/home/u/.config/Claude/claude_desktop_config.json');
    expect(vscode.configPath('/home/u', 'linux', {})).toBe('/home/u/.config/Code/User/mcp.json');
    expect(PI.configPath('/home/u', 'linux', {})).toBe('/home/u/.pi/agent/mcp.json');
  });

  it('macOS：Application Support', () => {
    expect(claude.configPath('/Users/u', 'darwin', {})).toBe('/Users/u/Library/Application Support/Claude/claude_desktop_config.json');
  });

  it('Windows：APPDATA 优先', () => {
    expect(claude.configPath('C:\\Users\\u', 'win32', { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' })).toBe(
      'C:\\Users\\u\\AppData\\Roaming/Claude/claude_desktop_config.json',
    );
  });

  it('home 末尾斜杠不会产生双斜杠', () => {
    expect(PI.configPath('/home/u/', 'linux', {})).toBe('/home/u/.pi/agent/mcp.json');
  });
});

describe('配置条目生成', () => {
  it('普通客户端只有 command/args', () => {
    expect(buildEntry(claude, launch)).toEqual({ command: 'paintress', args: ['mcp'] });
  });

  it('VS Code 额外带 type: stdio', () => {
    expect(buildEntry(vscode, launch)).toEqual({ type: 'stdio', command: 'paintress', args: ['mcp'] });
  });

  it('片段：JSON 带顶层键，TOML 用 mcp_servers', () => {
    expect(JSON.parse(jsonSnippet(vscode, launch))).toEqual({
      servers: { paintress: { type: 'stdio', command: 'paintress', args: ['mcp'] } },
    });
    expect(tomlSnippet(launch)).toBe('[mcp_servers.paintress]\ncommand = "paintress"\nargs = ["mcp"]\n');
  });
});

describe('JSON 合并', () => {
  it('文件不存在 → create', () => {
    const plan = planJsonMerge(PI, '/x/mcp.json', null, launch);
    expect(plan.status).toBe('create');
    expect(JSON.parse(plan.next ?? '')).toEqual({ mcpServers: { paintress: { command: 'paintress', args: ['mcp'] } } });
  });

  it('保留其他顶层键与其他 server', () => {
    const existing = JSON.stringify({
      theme: 'dark',
      mcpServers: { other: { command: 'x' } },
    });
    const plan = planJsonMerge(PI, '/x/mcp.json', existing, launch);
    expect(plan.status).toBe('update');
    expect(JSON.parse(plan.next ?? '')).toEqual({
      theme: 'dark',
      mcpServers: { other: { command: 'x' }, paintress: { command: 'paintress', args: ['mcp'] } },
    });
  });

  it('条目一致 → noop', () => {
    const existing = JSON.stringify({ mcpServers: { paintress: { command: 'paintress', args: ['mcp'] } } });
    expect(planJsonMerge(PI, '/x/mcp.json', existing, launch).status).toBe('noop');
  });

  it('条目有差异 → update 覆盖该条', () => {
    const existing = JSON.stringify({ mcpServers: { paintress: { command: '/old/path', args: ['mcp'] } } });
    const plan = planJsonMerge(PI, '/x/mcp.json', existing, launch);
    expect(plan.status).toBe('update');
    expect(JSON.parse(plan.next ?? '').mcpServers.paintress.command).toBe('paintress');
  });

  it('非法 JSON → invalid，且不产出内容', () => {
    const plan = planJsonMerge(PI, '/x/mcp.json', '{ not json', launch);
    expect(plan.status).toBe('invalid');
    expect(plan.next).toBeNull();
  });

  it('顶层是数组或根键类型不对 → 安全兜底', () => {
    expect(planJsonMerge(PI, '/x/mcp.json', '[]', launch).status).toBe('invalid');
    const plan = planJsonMerge(PI, '/x/mcp.json', JSON.stringify({ mcpServers: ['bad'] }), launch);
    expect(plan.status).toBe('update');
    expect(JSON.parse(plan.next ?? '').mcpServers.paintress).toEqual({ command: 'paintress', args: ['mcp'] });
  });

  it('VS Code 的 rootKey 是 servers，不写 mcpServers', () => {
    const plan = planJsonMerge(vscode, '/x/mcp.json', null, launch);
    const parsed = JSON.parse(plan.next ?? '');
    expect(parsed.servers.paintress.type).toBe('stdio');
    expect(parsed.mcpServers).toBeUndefined();
  });
});

describe('TOML（只追加，不改写）', () => {
  it('文件不存在 → create（写入片段）', () => {
    const plan = planJsonMerge(codex, '/x/config.toml', null, launch);
    expect(plan.status).toBe('create');
    expect(plan.next).toContain('[mcp_servers.paintress]');
  });

  it('无条目 → 追加片段', () => {
    const plan = planJsonMerge(codex, '/x/config.toml', 'model = "o3"\n', launch);
    expect(plan.status).toBe('update');
    expect(plan.next).toContain('model = "o3"');
    expect(plan.next).toContain('[mcp_servers.paintress]');
    expect(plan.next?.endsWith('\n')).toBe(true);
  });

  it('已有条目 → noop（不重复追加）', () => {
    const existing = '[mcp_servers.paintress]\ncommand = "paintress"\nargs = ["mcp"]\n';
    expect(planJsonMerge(codex, '/x/config.toml', existing, launch).status).toBe('noop');
  });
});

describe('启动命令解析', () => {
  const base = { scriptPath: '/usr/lib/node_modules/paintress/dist/cli.js', platform: 'linux' as const };

  it('PATH 上的 paintress 指向自己 → 裸命令（全局安装）', () => {
    const cmd = resolveLaunchCommand({
      ...base,
      pathEnv: '/usr/bin:/usr/local/bin',
      exists: (p) => p === '/usr/local/bin/paintress',
      realpath: (p) => (p === '/usr/local/bin/paintress' ? base.scriptPath : p),
    });
    expect(cmd).toEqual({ command: 'paintress', args: ['mcp'] });
  });

  it('PATH 上的同名文件指向别处 → 回退绝对路径', () => {
    const cmd = resolveLaunchCommand({
      ...base,
      pathEnv: '/usr/local/bin',
      exists: () => true,
      // 只有脚本自身保持原路径；PATH 上的同名文件指向别处
      realpath: (p) => (p === base.scriptPath ? p : '/somewhere/else/cli.js'),
    });
    expect(cmd).toEqual({ command: base.scriptPath, args: ['mcp'] });
  });

  it('PATH 为空 → 回退绝对路径', () => {
    const cmd = resolveLaunchCommand({ ...base, pathEnv: undefined, exists: () => false, realpath: (p) => p });
    expect(cmd.command).toBe(base.scriptPath);
  });

  it('多余斜杠与空段被忽略', () => {
    const cmd = resolveLaunchCommand({
      ...base,
      pathEnv: '::/opt/bin/::',
      exists: (p) => p === '/opt/bin/paintress',
      realpath: () => base.scriptPath,
    });
    expect(cmd.command).toBe('paintress');
  });
});

describe('落盘', () => {
  it('dryRun 不创建文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ptr-plan-'));
    const path = join(dir, 'mcp.json');
    applyPlan(path, '{}', true);
    expect(existsSync(path)).toBe(false);
  });

  it('写入前备份，写入后内容正确', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ptr-plan-'));
    const path = join(dir, 'mcp.json');
    writeFileSync(path, '{"a":1}\n');
    const { backup } = applyPlan(path, '{"a":2}\n', false);
    expect(backup).not.toBeNull();
    expect(readFileSync(path, 'utf8')).toBe('{"a":2}\n');
    expect(readFileSync(backup as string, 'utf8')).toBe('{"a":1}\n');
    expect(readdirSync(dir).some((f) => f.startsWith('mcp.json.bak-'))).toBe(true);
    expect(readdirSync(dir).some((f) => f.startsWith('.paintress-tmp-'))).toBe(false);
  });

  it('目录不存在时递归创建', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ptr-plan-'));
    const path = join(dir, 'nested/deep/mcp.json');
    applyPlan(path, '{}\n', false);
    expect(readConfig(path)).toBe('{}\n');
  });
});
