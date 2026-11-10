import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDaemon, type DaemonHandle } from '../src/web/daemon.js';
import { sendRequest } from '../src/web/client.js';
import { ChangesStore } from '../src/web/changes.js';

let home: string;
let daemon: DaemonHandle;
let baseUrl: string;
let projectDir: string;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'paintress-changes-'));
  process.env['PAINTRESS_HOME'] = home;
  projectDir = mkdtempSync(join(tmpdir(), 'paintress-changes-proj-'));
  copyFileSync(join(import.meta.dirname, 'fixtures/basic.pen'), join(projectDir, 'design.pen'));
  daemon = await startDaemon({ port: 0, idleTimeoutMs: 10 * 60_000, idleCheckMs: 60_000, quiet: true });
  baseUrl = `http://127.0.0.1:${daemon.port}`;
  await sendRequest({ kind: 'watch', project: 'chg', dir: projectDir });
});

afterAll(async () => {
  await daemon.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
  delete process.env['PAINTRESS_HOME'];
});

describe('socket changes → HTTP /api/changes', () => {
  it('绝对路径写入后，HTTP 能读到对应 ids', async () => {
    const res = await sendRequest({
      kind: 'changes',
      path: join(projectDir, 'design.pen'),
      ids: ['title', 'card'],
    });
    expect(res.ok).toBe(true);
    if (res.ok && 'recorded' in res) expect(res.recorded).toBe(2);

    const http = await fetch(`${baseUrl}/api/changes?project=chg&path=design.pen`);
    const body = (await http.json()) as { ok: boolean; ids: string[]; at: number };
    expect(body.ok).toBe(true);
    expect(body.ids.sort()).toEqual(['card', 'title']);
    expect(body.at).toBeGreaterThan(0);
  });

  it('项目外的路径被忽略', async () => {
    const res = await sendRequest({ kind: 'changes', path: '/etc/passwd', ids: ['x'] });
    expect(res.ok).toBe(true);
    if (res.ok && 'recorded' in res) expect(res.recorded).toBe(0);
  });

  it('嵌套项目时记到最深根，而不是外层项目', async () => {
    // 外层项目 root=projectDir，内层项目 root=projectDir/sub
    const sub = join(projectDir, 'sub');
    const fs = await import('node:fs/promises');
    await fs.mkdir(sub, { recursive: true });
    copyFileSync(join(projectDir, 'design.pen'), join(sub, 'inner.pen'));
    await sendRequest({ kind: 'watch', project: 'chg-outer', dir: projectDir });
    await sendRequest({ kind: 'watch', project: 'chg-inner', dir: sub });

    const res = await sendRequest({ kind: 'changes', path: join(sub, 'inner.pen'), ids: ['title'] });
    expect(res.ok).toBe(true);

    const inner = (await (await fetch(`${baseUrl}/api/changes?project=chg-inner&path=inner.pen`)).json()) as { ids: string[] };
    const outer = (await (await fetch(`${baseUrl}/api/changes?project=chg-outer&path=sub/inner.pen`)).json()) as { ids: string[] };
    expect(inner.ids).toContain('title');
    expect(outer.ids).not.toContain('title'); // 不应落到外层项目
  });
});

describe('ChangesStore 合并与过期', () => {
  it('合并窗口内 ids 合并，不重复', () => {
    const store = new ChangesStore();
    store.record('p', 'a.ptr', ['a', 'b']);
    store.record('p', 'a.ptr', ['b', 'c']);
    expect(store.get('p', 'a.ptr')?.ids.sort()).toEqual(['a', 'b', 'c']);
  });

  it('过期后 get 返回 undefined', () => {
    const store = new ChangesStore();
    const rec = store.record('p', 'a.ptr', ['a']);
    rec.at = Date.now() - 120_000; // 模拟两分钟前
    expect(store.get('p', 'a.ptr')).toBeUndefined();
  });

  it('prune 清理过期条目，保留新鲜条目', () => {
    const store = new ChangesStore();
    const old = store.record('p', 'old.ptr', ['a']);
    old.at = Date.now() - 120_000;
    store.record('p', 'fresh.ptr', ['b']);
    expect(store.prune()).toBe(1);
    expect(store.get('p', 'old.ptr')).toBeUndefined();
    expect(store.get('p', 'fresh.ptr')?.ids).toEqual(['b']);
  });
});


describe('MCP 写工具回传变更', () => {
  it('batch 插入的新节点 id 也会被记录（不依赖调用方先知道 id）', async () => {
    const { TOOLS } = await import('../src/mcp/tools.js');
    const tool = TOOLS['paintress_batch'];
    expect(tool).toBeDefined();

    const before = (await (await fetch(`${baseUrl}/api/changes?project=chg&path=design.pen`)).json()) as {
      ids: string[];
    };
    const beforeCount = before.ids.length;

    const res = (await tool!.run({
      path: join(projectDir, 'design.pen'),
      ops: [{ op: 'insert', parent: 'root', node: { type: 'note', name: 'BatchNote', content: 'x' } }],
    })) as { ok: boolean; result: { inserted: number } };

    expect(res.ok).toBe(true);
    expect(res.result.inserted).toBe(1);

    await new Promise((r) => setTimeout(r, 400)); // 等非阻塞通知送达 daemon
    const after = (await (await fetch(`${baseUrl}/api/changes?project=chg&path=design.pen`)).json()) as {
      ids: string[];
    };
    expect(after.ids.length).toBeGreaterThan(beforeCount);
  });

  it('update 只记录被更新的那一个 id', async () => {
    const { TOOLS } = await import('../src/mcp/tools.js');
    await TOOLS['paintress_update']!.run({
      path: join(projectDir, 'design.pen'),
      id: 'title',
      patch: { content: 'changed by test' },
    });
    await new Promise((r) => setTimeout(r, 400));
    const body = (await (await fetch(`${baseUrl}/api/changes?project=chg&path=design.pen`)).json()) as {
      ids: string[];
    };
    expect(body.ids).toContain('title');
  });
});
