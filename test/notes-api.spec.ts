import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDaemon, type DaemonHandle } from '../src/web/daemon.js';
import { sendRequest } from '../src/web/client.js';
import { COMPONENTS_FILE, PRESET_FILE } from '../src/doc/project.js';

/** daemon 侧：笔记 / 预设 / 组件库接口 + 项目脚手架 + 侧栏隐藏 __ 文件 */

const PROJECT = 'api-test';

let home: string;
let dir: string;
let daemon: DaemonHandle;
let base: string;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'paintress-api-home-'));
  process.env['PAINTRESS_HOME'] = home;
  dir = mkdtempSync(join(tmpdir(), 'paintress-api-proj-'));
  copyFileSync(join(import.meta.dirname, 'fixtures/basic.pen'), join(dir, 'design.ptr'));
  writeFileSync(join(dir, 'design.md'), '# 说明\n\n这是一份 **设计说明**。\n');
  daemon = await startDaemon({ port: 0, idleTimeoutMs: 10 * 60_000, idleCheckMs: 5_000, quiet: true });
  base = `http://127.0.0.1:${daemon.port}`;
  await sendRequest({ kind: 'watch', project: PROJECT, dir });
});

afterAll(async () => {
  await daemon.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
  delete process.env['PAINTRESS_HOME'];
});

const q = (path: string): string => encodeURIComponent(path);

describe('项目脚手架与文件列表', () => {
  it('watch 时自动建预设与组件库', async () => {
    const res = await fetch(`${base}/api/projects/${PROJECT}/files`);
    expect(res.status).toBe(200);
    // 两个 __ 文件不在设计稿列表里
    const body = (await res.json()) as { files: string[] };
    expect(body.files).toEqual(['design.ptr']);
  });

  it('预设接口能读到刚建好的空文件', async () => {
    const res = await fetch(`${base}/api/presets?project=${PROJECT}`);
    const body = (await res.json()) as { ok: boolean; path: string; items: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.path.endsWith(PRESET_FILE)).toBe(true);
    expect(body.items).toEqual([]);
  });
});

describe('笔记接口', () => {
  it('同名 md 存在时返回正文', async () => {
    const res = await fetch(`${base}/api/notes?project=${PROJECT}&path=${q('design.ptr')}`);
    const body = (await res.json()) as { ok: boolean; exists: boolean; markdown: string; path: string };
    expect(body).toMatchObject({ ok: true, exists: true, path: 'design.md' });
    expect(body.markdown).toContain('设计说明');
  });

  it('没有同名 md 时 exists=false', async () => {
    writeFileSync(join(dir, 'plain.ptr'), JSON.stringify({ version: '2.22', children: [] }));
    const res = await fetch(`${base}/api/notes?project=${PROJECT}&path=${q('plain.ptr')}`);
    expect(await res.json()).toMatchObject({ ok: true, exists: false });
  });

  it('路径穿越被拒', async () => {
    const res = await fetch(`${base}/api/notes?project=${PROJECT}&path=${q('../secret.ptr')}`);
    expect(res.status).toBe(404);
  });

  it('超大笔记返回 413', async () => {
    writeFileSync(join(dir, 'huge.ptr'), JSON.stringify({ version: '2.22', children: [] }));
    writeFileSync(join(dir, 'huge.md'), 'x'.repeat(600 * 1024));
    const res = await fetch(`${base}/api/notes?project=${PROJECT}&path=${q('huge.ptr')}`);
    expect(res.status).toBe(413);
  });
});

describe('预设写入', () => {
  it('缺 x-paintress 头时 403', async () => {
    const res = await fetch(`${base}/api/presets`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: PROJECT, key: 'color-brand', value: '#3B82F6' }),
    });
    expect(res.status).toBe(403);
  });

  it('写入后返回最新列表，值已归一', async () => {
    const res = await fetch(`${base}/api/presets`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-paintress': '1' },
      body: JSON.stringify({ project: PROJECT, key: 'color-brand', type: 'color', value: '#3b82f6', name: '主色' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { key: string; value: string; name: string }[] };
    expect(body.items).toEqual([{ key: 'color-brand', type: 'color', name: '主色', value: '#3B82F6' }]);
  });

  it('非法值 400，文件不变', async () => {
    const res = await fetch(`${base}/api/presets`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-paintress': '1' },
      body: JSON.stringify({ project: PROJECT, key: 'color-brand', value: 'red' }),
    });
    expect(res.status).toBe(400);
    const list = (await (await fetch(`${base}/api/presets?project=${PROJECT}`)).json()) as { items: { value: string }[] };
    expect(list.items[0]?.value).toBe('#3B82F6');
  });
});

describe('组件库', () => {
  it('空库返回空列表', async () => {
    const body = (await (await fetch(`${base}/api/components?project=${PROJECT}`)).json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it('登记组件后列表带渲染尺寸，且能单独渲染', async () => {
    writeFileSync(
      join(dir, COMPONENTS_FILE),
      JSON.stringify(
        {
          version: '2.22',
          fileToken: '00000000-0000-4000-8000-000000000002',
          variables: {},
          children: [
            {
              type: 'frame',
              id: 'cmp-btn',
              name: 'Button',
              reusable: true,
              width: 120,
              height: 40,
              fill: '$color-brand',
              children: [],
            },
          ],
          'x-paintress': { spec: '1', components: { version: 1 } },
        },
        null,
        2,
      ),
    );

    const body = (await (await fetch(`${base}/api/components?project=${PROJECT}`)).json()) as {
      items: { id: string; name: string; width: number; height: number }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: 'cmp-btn', name: 'Button', width: 120, height: 40 });

    const html = await (await fetch(`${base}/render-component?project=${PROJECT}&id=cmp-btn`)).text();
    expect(html).toContain('data-node-id="cmp-btn"');
    // 预设值已解析进渲染结果（组件里写的是 $color-brand）
    expect(html).toContain('#3B82F6');
  });

  it('未知组件 404', async () => {
    const res = await fetch(`${base}/render-component?project=${PROJECT}&id=nope`);
    expect(res.status).toBe(404);
  });
});
