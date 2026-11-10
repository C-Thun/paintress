import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDoc, query, get, update, insert, remove, move, batch, validateDoc } from '../src/index.js';

const fixtures = join(import.meta.dirname, 'fixtures');

function basic() {
  return loadDoc(join(fixtures, 'basic.pen')).doc;
}
function refDoc() {
  return loadDoc(join(fixtures, 'ref.pen')).doc;
}

describe('query', () => {
  it('按 type 过滤', () => {
    const hits = query(basic(), { type: 'text' });
    expect(hits.map((h) => h.id)).toEqual(['title']);
  });

  it('按 name 精确与正则', () => {
    expect(query(basic(), { name: 'Title' }).map((h) => h.id)).toEqual(['title']);
    expect(query(basic(), { name: '^T', nameRegex: true }).map((h) => h.id)).toEqual(['title']);
  });

  it('reusable 过滤', () => {
    const hits = query(refDoc(), { reusable: true });
    expect(hits.map((h) => h.id)).toEqual(['btn']);
  });

  it('路径含祖先 name', () => {
    const hits = query(refDoc(), { id: 'btn2' });
    expect(hits[0]?.path).toContain('DangerButton');
  });
});

describe('get', () => {
  it('depth 截断并标记', () => {
    const res = get(basic(), 'rootF', 0);
    expect(res?.truncated).toBe(true);
    const node = res?.node as Record<string, unknown>;
    expect(node['children']).toEqual(['…']);
  });

  it('depth=1：子层完整，孙层容器省略', () => {
    const res = get(refDoc(), 'btn', 1);
    const node = res?.node as Record<string, unknown>;
    const kids = node['children'] as Record<string, unknown>[];
    expect(kids[0]).toMatchObject({ type: 'text', content: 'Submit' });
  });

  it('不存在返回 null', () => {
    expect(get(basic(), 'nope')).toBeNull();
  });
});

describe('update', () => {
  it('浅合并并返回变更键', () => {
    const doc = basic();
    const { changed } = update(doc, 'title', { content: '改', fontSize: 30 });
    expect(changed).toEqual(['content']);
    const title = get(doc, 'title', 0)?.node as Record<string, unknown>;
    expect(title['content']).toBe('改');
  });

  it('禁止改 id 与 type', () => {
    const doc = basic();
    expect(() => update(doc, 'title', { id: 'newId' })).toThrow(/id/);
    expect(() => update(doc, 'title', { type: 'frame' })).toThrow(/type/);
  });

  it('节点不存在抛错', () => {
    expect(() => update(basic(), 'nope', {})).toThrow(/不存在/);
  });
});

describe('insert / remove / move', () => {
  it('insert：自动生成 id，落到指定父与位置', () => {
    const doc = basic();
    const id = insert(doc, 'rootF', { type: 'text', name: 'Sub', content: '新增' }, 0);
    expect(id).toMatch(/^[A-Za-z0-9]{5}$/);
    const res = get(doc, 'rootF', 1)?.node as Record<string, unknown>;
    const kids = res['children'] as Record<string, unknown>[];
    expect(kids[0]).toMatchObject({ name: 'Sub', content: '新增' });
  });

  it('insert：重复 id 拒绝', () => {
    expect(() => insert(basic(), 'root', { type: 'text', id: 'title' })).toThrow(/已存在/);
  });

  it('insert：不合法节点拒绝', () => {
    expect(() => insert(basic(), 'root', { type: 'frame', id: 'a/b' })).toThrow(/不合法/);
  });

  it('remove：摘除子树并返回', () => {
    const doc = basic();
    const removed = remove(doc, 'card');
    expect((removed as Record<string, unknown>)['id']).toBe('card');
    expect(query(doc, { id: 'card' })).toEqual([]);
  });

  it('move：换父并防环', () => {
    const doc = basic();
    move(doc, 'card', 'root');
    const rootIds = query(doc, {}).filter((h) => h.path === 'Card').map((h) => h.id);
    expect(rootIds).toEqual(['card']); // 现在路径无祖先前缀
    // 新文档：把 rootF 移到它自己的子树下必须失败
    expect(() => move(basic(), 'rootF', 'card')).toThrow(/子树|成环/);
  });
});

describe('batch', () => {
  it('成功路径：全部生效', () => {
    const doc = basic();
    const out = batch(doc, [
      { op: 'update', id: 'title', patch: { content: '批量' } },
      { op: 'insert', parent: 'root', node: { type: 'note', content: '批注' } },
    ]);
    expect((get(out, 'title', 0)?.node as Record<string, unknown>)['content']).toBe('批量');
    expect(query(out, { type: 'note' }).length).toBe(2);
    // 原文档未被改动（克隆语义）
    expect((get(doc, 'title', 0)?.node as Record<string, unknown>)['content']).toBe('Paintress');
  });

  it('失败路径：整体作废且原文档无损', () => {
    const doc = basic();
    expect(() =>
      batch(doc, [
        { op: 'update', id: 'title', patch: { content: '会作废' } },
        { op: 'delete', id: '不存在的' },
      ]),
    ).toThrow(/第 1 步/);
    expect((get(doc, 'title', 0)?.node as Record<string, unknown>)['content']).toBe('Paintress');
  });
});

describe('validateDoc 语义校验', () => {
  it('重复 id、悬空 ref、未定义变量各出 warning', () => {
    const doc = {
      version: '2.21',
      children: [
        { type: 'frame', id: 'a', children: [{ type: 'ref', id: 'r1', ref: 'missing' }] },
        { type: 'frame', id: 'a' },
        { type: 'text', id: 't', fill: '$nope' },
      ],
    };
    const res = validateDoc(doc);
    expect(res.ok).toBe(true);
    const msgs = res.warnings.map((w) => w.message).join('\n');
    expect(msgs).toContain('id 重复');
    expect(msgs).toContain('ref 指向不存在的组件 id "missing"');
    expect(msgs).toContain('$nope');
  });
});
