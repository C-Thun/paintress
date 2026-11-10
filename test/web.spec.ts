import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDaemon, type DaemonHandle } from '../src/web/daemon.js';
import { sendRequest, attachPersistent, isDaemonRunning } from '../src/web/client.js';
import { deriveProjectName, safeJoin, sanitizeProjectName } from '../src/web/paths.js';
import { Registry } from '../src/web/registry.js';

const PROJECT = 'test-proj';

let home: string;
let daemon: DaemonHandle;
let projectDir: string;
let baseUrl: string;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'paintress-home-'));
  process.env['PAINTRESS_HOME'] = home;

  projectDir = mkdtempSync(join(tmpdir(), 'paintress-proj-'));
  copyFileSync(join(import.meta.dirname, 'fixtures/basic.pen'), join(projectDir, 'design.pen'));
  // 嵌套目录，验证递归列举
  const nested = join(projectDir, 'sub');
  require('node:fs').mkdirSync(nested, { recursive: true });
  copyFileSync(join(import.meta.dirname, 'fixtures/ref.pen'), join(nested, 'ref.pen'));

  daemon = await startDaemon({ port: 0, idleTimeoutMs: 10 * 60_000, idleCheckMs: 5_000, quiet: true });
  baseUrl = `http://127.0.0.1:${daemon.port}`;
});

afterAll(async () => {
  await daemon.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
  delete process.env['PAINTRESS_HOME'];
});

describe('单实例与生命周期', () => {
  it('控制面 socket 已就绪', () => {
    expect(isDaemonRunning()).toBe(true);
  });

  it('重复启动被拒绝（lock 生效）', async () => {
    await expect(startDaemon({ port: 0, quiet: true })).rejects.toThrow(/已在运行/);
  });

  it('ping 返回 pid 与项目数', async () => {
    const res = await sendRequest({ kind: 'ping' });
    expect(res.ok).toBe(true);
    if (res.ok && 'pong' in res) {
      expect(res.pid).toBe(daemon.pid);
      expect(typeof res.projects).toBe('number');
    }
  });
});

describe('项目注册', () => {
  it('watch 注册目录并统计设计稿', async () => {
    const res = await sendRequest({ kind: 'watch', project: PROJECT, dir: projectDir });
    expect(res.ok).toBe(true);
    if (res.ok && 'watched' in res) {
      expect(res.project.name).toBe(PROJECT);
      expect(res.project.fileCount).toBe(2); // design.pen + sub/ref.pen
    }
  });

  it('同名不同目录被拒绝', async () => {
    const other = mkdtempSync(join(tmpdir(), 'paintress-other-'));
    try {
      const res = await sendRequest({ kind: 'watch', project: PROJECT, dir: other });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/已被|占用/);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('attach 计入 agentConns，断开后归零', async () => {
    const handle = await attachPersistent(PROJECT);
    const before = await sendRequest({ kind: 'status' });
    if (before.ok && 'version' in before) {
      expect(before.projects.find((p) => p.name === PROJECT)?.agentConns).toBe(1);
    }
    handle.close();
    await new Promise((r) => setTimeout(r, 150));
    const after = await sendRequest({ kind: 'status' });
    if (after.ok && 'version' in after) {
      expect(after.projects.find((p) => p.name === PROJECT)?.agentConns).toBe(0);
    }
  });

  it('attach 未注册项目报错', async () => {
    await expect(attachPersistent('不存在')).rejects.toThrow(/未注册/);
  });
});

describe('HTTP 路由', () => {
  it('根路径列出项目', async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(PROJECT);
  });

  it('项目路径列出设计稿', async () => {
    const res = await fetch(`${baseUrl}/${PROJECT}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('design.pen');
    expect(html).toContain('sub/ref.pen');
  });

  it('渲染设计稿：含 data-node-id 与热重载脚本', async () => {
    const res = await fetch(`${baseUrl}/${PROJECT}/design.pen`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('data-node-id="title"');
    expect(html).toContain('EventSource');
  });

  it('未注册项目 404', async () => {
    const res = await fetch(`${baseUrl}/no-such-project`);
    expect(res.status).toBe(404);
  });

  it('路径穿越被拦截（编码形式）', async () => {
    const res = await fetch(`${baseUrl}/${PROJECT}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain('root:');
  });
});

describe('纯函数', () => {
  it('sanitizeProjectName 清除危险字符', () => {
    expect(sanitizeProjectName('../etc')).toBe('etc');
    expect(sanitizeProjectName('a/b c')).toBe('a-b-c');
    expect(sanitizeProjectName('')).toBe('project');
  });

  it('deriveProjectName 取父/自身两级', () => {
    expect(deriveProjectName('/home/u/repos/org/proj')).toBe('org-proj');
  });

  it('safeJoin 拒绝越界与符号链接逃逸', () => {
    const root = '/tmp/xyz-root';
    require('node:fs').mkdirSync(root, { recursive: true });
    expect(safeJoin(root, '../etc/passwd')).toBeNull();
    expect(safeJoin(root, 'a/../../etc/passwd')).toBeNull();
    expect(safeJoin(root, '.../..')).toBeNull();
  });
});

describe('idle 自动退出', () => {
  it('无任何连接且超过 idleTimeout 后自动关闭', async () => {
    await daemon.close();
    const idle = await startDaemon({ port: 0, idleTimeoutMs: 200, idleCheckMs: 50, quiet: true });
    const pid = idle.pid;
    expect(pid).toBeGreaterThan(0);
    // 等待自动退出
    await new Promise((r) => setTimeout(r, 700));
    // 退出后 socket 应消失
    expect(isDaemonRunning()).toBe(false);
    // 重新拉起供 afterAll 收尾
    daemon = await startDaemon({ port: 0, quiet: true });
  }, 15_000);
});

describe('Registry 内部行为', () => {
  it('listDesigns 跳过 node_modules 与隐藏目录', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paintress-scan-'));
    try {
      writeFileSync(join(dir, 'a.pen'), '{}');
      require('node:fs').mkdirSync(join(dir, 'node_modules'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'b.pen'), '{}');
      require('node:fs').mkdirSync(join(dir, '.git'), { recursive: true });
      writeFileSync(join(dir, '.git', 'c.pen'), '{}');
      const reg = new Registry();
      const entry = reg.watch('scan', dir);
      expect(reg.listDesigns(entry)).toEqual(['a.pen']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
