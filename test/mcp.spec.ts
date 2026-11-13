import { readFileSync, copyFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';

/** MCP 全链路：InMemoryTransport 上跑客户端-服务端，写工具作用在临时副本上 */

let client: Client;
let cleanup: () => void;
let tmpFile: string;

beforeAll(async () => {
  const server = createMcpServer();
  const [clientTrans, serverTrans] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTrans);
  client = new Client({ name: 'paintress-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTrans);

  const tmp = mkdtempSync(join(tmpdir(), 'paintress-mcp-'));
  tmpFile = join(tmp, 'work.pen');
  copyFileSync(join(import.meta.dirname, 'fixtures/basic.pen'), tmpFile);
  cleanup = () => rmSync(tmp, { recursive: true, force: true });
});
afterAll(() => cleanup());

interface ToolPayload {
  ok?: boolean;
  isError?: boolean;
  content: { type: string; text: string }[];
}

async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = (await client.callTool({ name, arguments: args })) as unknown as ToolPayload;
  const text = res.content?.[0]?.text;
  if (!text) throw new Error(`工具 ${name} 无文本输出`);
  return JSON.parse(text);
}

async function callRaw(name: string, args: Record<string, unknown>): Promise<ToolPayload> {
  return (await client.callTool({ name, arguments: args })) as unknown as ToolPayload;
}

describe('工具发现', () => {
  it('注册 16 个工具', async () => {
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual([
      'paintress_batch', 'paintress_component', 'paintress_delete', 'paintress_doc_info',
      'paintress_get', 'paintress_insert', 'paintress_marks', 'paintress_move',
      'paintress_new', 'paintress_preset', 'paintress_query', 'paintress_render',
      'paintress_screenshot', 'paintress_update', 'paintress_validate', 'paintress_viewer',
    ]);
  });

  it('连接说明里点名「作画前先确保查看器」且声明幂等', async () => {
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toContain('paintress_viewer');
    expect(instructions).toContain('paintress web --daemon');
    expect(instructions.toLowerCase()).toContain('idempotent');
  });
});

describe('读工具', () => {
  it('doc_info：摘要与统计', async () => {
    const info = (await call('paintress_doc_info', { path: tmpFile })) as Record<string, unknown>;
    expect(info['flavor']).toBe('pen');
    expect(info['nodeCount']).toBe(5);
    expect(info['byType']).toMatchObject({ frame: 1, text: 1, rectangle: 1, icon: 1, note: 1 });
    expect(info['variables']).toEqual(['accent', 'gap-md']);
  });

  it('query：type 过滤', async () => {
    const hits = (await call('paintress_query', { path: tmpFile, type: 'text' })) as unknown[];
    expect(hits).toHaveLength(1);
    expect((hits[0] as Record<string, unknown>)['id']).toBe('title');
  });

  it('get：depth 截断', async () => {
    const res = (await call('paintress_get', { path: tmpFile, id: 'rootF', depth: 0 })) as Record<string, unknown>;
    expect(res['truncated']).toBe(true);
  });

  it('validate：干净文档无警告', async () => {
    const v = (await call('paintress_validate', { path: tmpFile })) as Record<string, unknown>;
    expect(v['ok']).toBe(true);
    expect(v['warnings']).toEqual([]);
  });
});

describe('写工具（临时副本上）', () => {
  it('update → 落盘可复读', async () => {
    const res = (await call('paintress_update', { path: tmpFile, id: 'title', patch: { content: 'MCP 改的' } })) as Record<string, unknown>;
    expect(res['ok']).toBe(true);
    const onDisk = JSON.parse(readFileSync(tmpFile, 'utf8')) as { children: { children: { id: string; content: string }[] }[] };
    const title = onDisk.children[0]?.children.find((c) => c.id === 'title');
    expect(title?.content).toBe('MCP 改的');
  });

  it('insert → 返回新 id 且落盘', async () => {
    const res = (await call('paintress_insert', {
      path: tmpFile,
      parent: 'root',
      node: { type: 'note', name: 'MCP 注', content: '来自 MCP' },
    })) as { ok: boolean; result: string };
    expect(res['ok']).toBe(true);
    const newId = res['result'];
    expect(newId).toMatch(/^[A-Za-z0-9]{5}$/);
    const got = (await call('paintress_get', { path: tmpFile, id: newId })) as Record<string, unknown>;
    expect(got['node']).toMatchObject({ name: 'MCP 注' });
  });

  it('batch：多步原子生效', async () => {
    const before = (await call('paintress_doc_info', { path: tmpFile })) as { nodeCount: number };
    const res = (await call('paintress_batch', {
      path: tmpFile,
      ops: [
        { op: 'update', id: 'title', patch: { fontWeight: '700' } },
        { op: 'insert', parent: 'root', node: { type: 'note', content: '批量注' } },
      ],
    })) as Record<string, unknown>;
    expect(res['ok']).toBe(true);
    const after = (await call('paintress_doc_info', { path: tmpFile })) as { nodeCount: number };
    expect(after.nodeCount).toBe(before.nodeCount + 1);
  });

  it('delete → 节点消失', async () => {
    const res = (await call('paintress_delete', { path: tmpFile, id: 'card' })) as { result: { deleted: { id: string } } };
    expect(res['result']['deleted']['id']).toBe('card');
    const hits = (await call('paintress_query', { path: tmpFile, id: 'card' })) as unknown[];
    expect(hits).toHaveLength(0);
  });

  it('move → 换父成功', async () => {
    const res = (await call('paintress_move', { path: tmpFile, id: 'star', parent: 'root' })) as Record<string, unknown>;
    expect(res['ok']).toBe(true);
    const hits = (await call('paintress_query', { path: tmpFile, id: 'star' })) as { path: string }[];
    expect(hits[0]?.['path']).toBe('Star');
  });
});

describe('新建文档', () => {
  it('默认补 .ptr，产出可读可渲染的标准文档', async () => {
    const target = join(tmpFile, '..', 'new/nested/created');  // 不带扩展名，父目录也不存在
    const res = (await call('paintress_new', { path: target, name: 'Home', width: 320, height: 640 })) as Record<string, unknown>;
    expect(res['ok']).toBe(true);
    expect(res['path']).toBe(`${target}.ptr`);
    expect(res['flavor']).toBe('ptr');

    const info = (await call('paintress_doc_info', { path: `${target}.ptr` })) as Record<string, unknown>;
    expect(info['flavor']).toBe('ptr');
    expect(info['nodeCount']).toBe(1);
    expect(info['topLevel']).toContainEqual({ id: res['boardId'], name: 'Home', type: 'frame' });

    // x-paintress 写入（ptr 层要求 spec 字段）
    const raw = JSON.parse(readFileSync(`${target}.ptr`, 'utf8')) as Record<string, unknown>;
    expect((raw['x-paintress'] as Record<string, unknown>)['spec']).toBe('1');
  });

  it('已存在时拒绝覆盖，overwrite=true 才写', async () => {
    const target = join(tmpFile, '..', 'dup.ptr');
    await call('paintress_new', { path: target });
    const blocked = await callRaw('paintress_new', { path: target });
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0]?.text).toContain('已存在');
    const forced = (await call('paintress_new', { path: target, overwrite: true, name: 'Second' })) as Record<string, unknown>;
    expect(forced['ok']).toBe(true);
  });

  it('显式 .pen 路径仍创建兼容格式，不注入 ptr 扩展', async () => {
    const target = join(tmpFile, '..', 'legacy.pen');
    const res = (await call('paintress_new', { path: target })) as Record<string, unknown>;
    expect(res['flavor']).toBe('pen');
    const raw = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
    expect(raw['x-paintress']).toBeUndefined();
  });

  it('零或负尺寸拒绝创建，避免产出不可截图的画布', async () => {
    const target = join(tmpFile, '..', 'bad-size.ptr');
    for (const args of [{ width: 0 }, { width: -20 }, { height: 0 }]) {
      const res = await callRaw('paintress_new', { path: target, ...args });
      expect(res.isError).toBe(true);
    }
    expect(existsSync(target)).toBe(false);
  });

  it('新建后可直接 insert 子节点', async () => {
    const target = join(tmpFile, '..', 'grow.ptr');
    const created = (await call('paintress_new', { path: target, padding: 16, gap: 8 })) as Record<string, unknown>;
    const ins = (await call('paintress_insert', {
      path: target,
      parent: created['boardId'],
      node: { type: 'text', content: 'Hello', fontSize: 20 },
    })) as Record<string, unknown>;
    expect(ins['ok']).toBe(true);
    const q = (await call('paintress_query', { path: target, type: 'text' })) as { id: string }[];
    expect(q).toHaveLength(1);
  });
});

describe('渲染工具', () => {
  it('render：产出 HTML 文件，含 data-node-id 与画布尺寸', async () => {
    const outHtml = join(tmpFile, '..', 'rendered.html');
    const res = (await call('paintress_render', { path: tmpFile, out: outHtml })) as Record<string, unknown>;
    expect(res['ok']).toBe(true);
    expect(res['canvas']).toMatchObject({ width: 800, height: 600 });
    const html = readFileSync(outHtml, 'utf8');
    expect(html).toContain('data-node-id="title"');
    expect(html).toContain('color:#6BA3FF');
  });
});

describe('错误传播', () => {
  it('不存在的节点 → isError 且带信息', async () => {
    const res = await callRaw('paintress_update', { path: tmpFile, id: '不存在', patch: { x: 1 } });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('不存在');
  });

  it('文件不存在 → isError', async () => {
    const res = await callRaw('paintress_doc_info', { path: '/tmp/definitely-not-here.pen' });
    expect(res.isError).toBe(true);
  });
});
