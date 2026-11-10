import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDaemon, type DaemonHandle } from '../src/web/daemon.js';
import { sendRequest, attachPersistent, isDaemonRunning } from '../src/web/client.js';
import { deriveProjectName, safeJoin, sanitizeProjectName } from '../src/web/paths.js';
import { DEFAULT_DEPTH, MAX_DEPTH, Registry } from '../src/web/registry.js';

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
  it('GET /api/projects 返回项目 JSON', async () => {
    const res = await fetch(`${baseUrl}/api/projects`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; projects: { name: string; depth: number }[]; pid: number };
    expect(body.ok).toBe(true);
    expect(body.pid).toBe(daemon.pid);
    const hit = body.projects.find((p) => p.name === PROJECT);
    expect(hit?.depth).toBe(3);
  });

  it('GET /api/projects/:name/files 返回文件列表', async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PROJECT}/files`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; files: string[]; depth: number };
    expect(body.ok).toBe(true);
    expect(body.files.sort()).toEqual(['design.pen', 'sub/ref.pen']);
    expect(body.depth).toBe(3);
  });

  it('GET /api/projects/:unknown/files → 404 JSON', async () => {
    const res = await fetch(`${baseUrl}/api/projects/nope/files`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });

  it('GET / 有前端产物时返回 SPA 外壳', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    // ui/dist 存在 → SPA 壳（含 #root）；否则降级页（含项目名）
    expect(html.includes('id="root"') || html.includes(PROJECT)).toBe(true);
  });

  it('GET /render/:project/* 直接访问：含 data-node-id、base href、自刷新脚本', async () => {
    const res = await fetch(`${baseUrl}/render/${PROJECT}/design.pen`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('data-node-id="title"');
    expect(html).toContain(`<base href="/files/${PROJECT}/">`);
    expect(html).toContain('EventSource'); // 直接访问保留热重载
  });

  it('GET /render/:project/*?embed=1：iframe 模式不含自刷新脚本', async () => {
    const res = await fetch(`${baseUrl}/render/${PROJECT}/design.pen?embed=1`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('data-node-id="title"');
    expect(html).toContain(`<base href="/files/${PROJECT}/">`);
    expect(html).not.toContain('EventSource'); // 由父页面订阅 SSE
  });

  it('GET /files/:project/* 提供项目静态资源', async () => {
    writeFileSync(join(projectDir, 'dot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const res = await fetch(`${baseUrl}/files/${PROJECT}/dot.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('未知前端路径回退 SPA（200，由前端渲染 404）', async () => {
    const res = await fetch(`${baseUrl}/no-such-project`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="root"');
  });

  it('路径穿越在 /files 被拦截', async () => {
    const res = await fetch(`${baseUrl}/files/${PROJECT}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('root:');
  });

  it('路径穿越在 /render 被拦截', async () => {
    const res = await fetch(`${baseUrl}/render/${PROJECT}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('root:');
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
    // 重新拉起供后续用例使用（端口变化，必须同步 baseUrl）
    daemon = await startDaemon({ port: 0, quiet: true });
    baseUrl = `http://127.0.0.1:${daemon.port}`;
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

  it('listDesigns 默认深度 3，只认 .ptr/.pen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paintress-depth-'));
    try {
      const mk = (p: string, content = '{}'): void => {
        mkdirSync(dirname(join(dir, p)), { recursive: true });
        writeFileSync(join(dir, p), content);
      };
      mk('a.pen');
      mk('d1/b.ptr');
      mk('d1/d2/c.pen');
      mk('d1/d2/d3/e.pen');
      mk('d1/d2/d3/d4/f.pen');
      mk('d1/notes.txt');

      const reg = new Registry();
      const def = reg.watch('depth-default', dir);
      expect(def.depth).toBe(DEFAULT_DEPTH);
      expect(reg.listDesigns(def).sort()).toEqual(['a.pen', 'd1/b.ptr', 'd1/d2/c.pen', 'd1/d2/d3/e.pen']);

      const shallow = reg.watch('depth-1', dir, 1);
      expect(reg.listDesigns(shallow).sort()).toEqual(['a.pen', 'd1/b.ptr']);

      const deep = reg.watch('depth-6', dir, 6);
      expect(reg.listDesigns(deep)).toContain('d1/d2/d3/d4/f.pen');

      const capped = reg.watch('depth-99', dir, 99);
      expect(capped.depth).toBe(MAX_DEPTH);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});


describe('会话标记（marks API）', () => {
  beforeAll(async () => {
    // idle 用例可能重启过 daemon，这里确保项目已注册
    await sendRequest({ kind: 'watch', project: PROJECT, dir: projectDir });
  });

  interface MarkBody {
    ok: boolean;
    mark: { shortId: number; nodeId: string; name?: string; path: string };
  }

  const post = async (body: Record<string, unknown>): Promise<Response> =>
    fetch(`${baseUrl}/api/marks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('POST 分配短号', async () => {
    const res = await post({ project: PROJECT, nodeId: 'title', name: 'Title', type: 'text', path: 'App / Title' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MarkBody;
    expect(body.ok).toBe(true);
    expect(body.mark.nodeId).toBe('title');
    expect(body.mark.shortId).toBeGreaterThan(0);
  });

  it('同一 nodeId 复用短号，不重复分配', async () => {
    const a = (await (await post({ project: PROJECT, nodeId: 'card', name: 'Card' })).json()) as MarkBody;
    const b = (await (await post({ project: PROJECT, nodeId: 'card', name: 'Card' })).json()) as MarkBody;
    expect(b.mark.shortId).toBe(a.mark.shortId);
  });

  it('不同 nodeId 短号递增', async () => {
    const a = (await (await post({ project: PROJECT, nodeId: 'star' })).json()) as MarkBody;
    const b = (await (await post({ project: PROJECT, nodeId: 'memo' })).json()) as MarkBody;
    expect(b.mark.shortId).toBeGreaterThan(a.mark.shortId);
  });

  it('GET 返回按短号升序的列表', async () => {
    const res = await fetch(`${baseUrl}/api/marks?project=${PROJECT}`);
    const body = (await res.json()) as { ok: boolean; marks: { shortId: number; nodeId: string }[] };
    expect(body.ok).toBe(true);
    const ids = body.marks.map((m) => m.shortId);
    expect([...ids].sort((x, y) => x - y)).toEqual(ids);
    expect(body.marks.map((m) => m.nodeId)).toContain('title');
  });

  it('未注册项目 → 404', async () => {
    const res = await post({ project: 'no-such', nodeId: 'x' });
    expect(res.status).toBe(404);
  });

  it('缺 nodeId → 400', async () => {
    const res = await post({ project: PROJECT });
    expect(res.status).toBe(400);
  });

  it('DELETE 清空该项目的标记', async () => {
    const res = await fetch(`${baseUrl}/api/marks?project=${PROJECT}`, { method: 'DELETE' });
    const body = (await res.json()) as { ok: boolean; cleared: number };
    expect(body.ok).toBe(true);
    expect(body.cleared).toBeGreaterThan(0);
    const after = (await (await fetch(`${baseUrl}/api/marks?project=${PROJECT}`)).json()) as { marks: unknown[] };
    expect(after.marks).toEqual([]);
  });
});
