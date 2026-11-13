import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMPONENTS_FILE, ensureProjectScaffold, listComponents, PRESET_FILE, setPreset } from '../src/doc/project.js';
import { collectIds } from '../src/doc/id.js';
import { loadDoc } from '../src/doc/io.js';
import { validateDoc } from '../src/doc/validate.js';
import { TOOLS } from '../src/mcp/tools.js';

/** 项目组件库：扫描 reusable、复制插入（重排 id + 展开内部 ref） */

let root: string;
let design: string;
let components: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'paintress-comp-'));
  copyFileSync(join(import.meta.dirname, 'fixtures/basic.pen'), join(root, 'design.ptr'));
  design = join(root, 'design.ptr');
  ensureProjectScaffold(root);
  components = join(root, COMPONENTS_FILE);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** 组件库：一个按钮 + 一个内部引用了按钮的卡片（验证复制时 ref 会被展开） */
function writeComponents(): void {
  writeFileSync(
    components,
    JSON.stringify(
      {
        version: '2.22',
        fileToken: '00000000-0000-4000-8000-000000000001',
        variables: {},
        children: [
          {
            type: 'frame',
            id: 'cmp-btn',
            name: 'Button / Primary',
            reusable: true,
            width: 120,
            height: 40,
            fill: '$color-brand',
            children: [{ type: 'text', id: 'cmp-btn-label', content: 'OK', fontSize: 14, fill: '#FFFFFF' }],
          },
          {
            type: 'frame',
            id: 'cmp-card',
            name: 'Card',
            reusable: true,
            width: 320,
            height: 200,
            children: [
              { type: 'ref', id: 'cmp-card-btn', ref: 'cmp-btn', width: 120, height: 40 },
            ],
          },
        ],
        'x-paintress': { spec: '1', components: { version: 1 } },
      },
      null,
      2,
    ),
  );
}

describe('组件库扫描', () => {
  it('空库返回空列表', () => {
    expect(listComponents(components)).toEqual([]);
  });

  it('全树扫描 reusable 节点，名称回退到 id', () => {
    writeComponents();
    setPreset(root, { key: 'color-brand', type: 'color', value: '#205080' });
    const items = listComponents(components);
    expect(items.map((c) => c.id)).toEqual(['cmp-btn', 'cmp-card']);
    expect(items[0]).toMatchObject({ name: 'Button / Primary', type: 'frame', width: 120, height: 40 });
  });

  it('paintress_component list 走同一个项目路径', async () => {
    const res = (await TOOLS['paintress_component']!.run({ action: 'list', path: design })) as {
      path: string;
      items: { id: string }[];
    };
    expect(res.path).toBe(components);
    expect(res.items.map((c) => c.id)).toEqual(['cmp-btn', 'cmp-card']);
  });
});

describe('复制插入', () => {
  it('重排 id、展开内部 ref、目标文件可独立校验', async () => {
    const before = loadDoc(design).doc;
    const beforeIds = new Set(collectIds(before.children));

    const res = (await TOOLS['paintress_component']!.run({
      action: 'insert',
      path: design,
      id: 'cmp-card',
    })) as { result: { id: string } };

    const after = loadDoc(design).doc;
    const afterIds = collectIds(after.children);
    // 新 id 不在旧 id 集合里，且整棵树没有重复
    expect(beforeIds.has(res.result.id)).toBe(false);
    expect(new Set(afterIds).size).toBe(afterIds.length);

    // 卡片里的 ref 已展开成按钮本体（复制件自包含，不依赖组件库）
    const card = after.children.find((c) => (c as Record<string, unknown>)['id'] === res.result.id) as Record<string, unknown>;
    expect(card).toBeDefined();
    const kids = card['children'] as Record<string, unknown>[];
    expect(kids.some((k) => k['type'] === 'ref')).toBe(false);
    expect(kids.some((k) => k['name'] === 'Button / Primary' || k['reusable'] === true)).toBe(true);
    // 实例不该带 reusable（否则设计稿里又多出一份组件定义）
    expect(card['reusable']).toBeUndefined();

    // 校验：结构 0 错误，且不因预设变量报「未定义」
    const mergedNames = new Set(Object.keys(loadDoc(join(root, PRESET_FILE)).doc.variables ?? {}));
    const v = validateDoc(after, { knownVars: mergedNames, presetVars: mergedNames });
    expect(v.ok).toBe(true);
    expect(v.warnings.some((w) => w.message.includes('未定义的变量'))).toBe(false);
  });

  it('复制件整棵子树都不带 reusable（嵌套组件也不漏）', async () => {
    const res = (await TOOLS['paintress_component']!.run({
      action: 'insert',
      path: design,
      id: 'cmp-card',
    })) as { result: { id: string } };
    const after = loadDoc(design).doc;
    const card = after.children.find((c) => (c as Record<string, unknown>)['id'] === res.result.id) as Record<string, unknown>;
    const allReusable = (n: Record<string, unknown>): string[] => {
      const ids = n['reusable'] === true ? [String(n['id'])] : [];
      for (const k of (n['children'] ?? []) as Record<string, unknown>[]) ids.push(...allReusable(k));
      return ids;
    };
    expect(allReusable(card)).toEqual([]);
  });

  it('组件不存在时列出可用 id 的提示', async () => {
    expect(() => TOOLS['paintress_component']!.run({ action: 'insert', path: design, id: 'nope' })).toThrow(
      /组件不存在：nope/,
    );
  });
});
