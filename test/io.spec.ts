import { readFileSync, writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { loadDoc, saveDoc, serializeDoc, FileChangedError } from '../src/index.js';

const fixtures = join(import.meta.dirname, 'fixtures');
let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'paintress-io-'));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('loadDoc', () => {
  it('basic.pen：pen 风味，校验通过，无错误', () => {
    const loaded = loadDoc(join(fixtures, 'basic.pen'));
    expect(loaded.flavor).toBe('pen');
    expect(loaded.validation.ok).toBe(true);
    expect(loaded.validation.errors).toEqual([]);
    expect(loaded.validation.warnings).toEqual([]);
  });

  it('unknown.pen：未知类型保留为 warning，不丢数据', () => {
    const loaded = loadDoc(join(fixtures, 'unknown.pen'));
    expect(loaded.validation.ok).toBe(true);
    const msgs = loaded.validation.warnings.map((w) => w.message);
    expect(msgs.some((m) => m.includes('hologram'))).toBe(true);
    // 未知 $ghost 变量也应出 warning
    expect(msgs.some((m) => m.includes('$ghost'))).toBe(true);
    // 子树仍在
    const host = loaded.doc.children[0] as Record<string, unknown>;
    const kids = host['children'] as Record<string, unknown>[];
    expect(kids[0]?.['type']).toBe('hologram');
    expect(kids[0]?.['intensity']).toBe(7); // 未知字段透传
  });

  it('JSON 语法错误：报错带文件路径', () => {
    const bad = join(tmp, 'bad.pen');
    writeFileSync(bad, '{ not json', 'utf8');
    expect(() => loadDoc(bad)).toThrow(/JSON 解析失败/);
  });

  it('ref.pen：正常解析，无悬空 ref 警告', () => {
    const loaded = loadDoc(join(fixtures, 'ref.pen'));
    expect(loaded.validation.warnings).toEqual([]);
  });
});

describe('round-trip', () => {
  it('serializeDoc(parse(f)) 与 reparse(f) 深度相等', () => {
    for (const name of ['basic.pen', 'ref.pen', 'unknown.pen']) {
      const text = readFileSync(join(fixtures, name), 'utf8');
      const loaded = loadDoc(join(fixtures, name));
      expect(JSON.parse(serializeDoc(loaded.doc)), name).toEqual(JSON.parse(text));
    }
  });

  it('save 后再 load：字节级稳定', () => {
    const dst = join(tmp, 'rt.pen');
    const loaded = loadDoc(join(fixtures, 'basic.pen'));
    saveDoc(dst, loaded.doc, { flavor: 'pen' });
    const first = readFileSync(dst, 'utf8');
    const reloaded = loadDoc(dst);
    saveDoc(dst, reloaded.doc, { flavor: 'pen', expectedMtimeMs: reloaded.mtimeMs });
    expect(readFileSync(dst, 'utf8')).toBe(first);
  });
});

describe('saveDoc：ptr 风味与安全', () => {
  it('另存为 .ptr：注入 x-paintress.spec=1', () => {
    const dst = join(tmp, 'out.ptr');
    const loaded = loadDoc(join(fixtures, 'basic.pen'));
    saveDoc(dst, loaded.doc, { flavor: 'ptr' });
    const saved = JSON.parse(readFileSync(dst, 'utf8')) as Record<string, unknown>;
    const ext = saved['x-paintress'] as Record<string, unknown>;
    expect(ext['spec']).toBe('1');
    expect(typeof ext['updated_at']).toBe('string');
  });

  it('mtime 防覆盖：读入后文件被改动 → FileChangedError', () => {
    const dst = join(tmp, 'guard.pen');
    const loaded = loadDoc(join(fixtures, 'basic.pen'));
    saveDoc(dst, loaded.doc, { flavor: 'pen' });
    const reloaded = loadDoc(dst);
    // 模拟外部修改：触碰 mtime
    const now = new Date(Date.now() + 2000);
    utimesSync(dst, now, now);
    expect(() => saveDoc(dst, reloaded.doc, { flavor: 'pen', expectedMtimeMs: reloaded.mtimeMs })).toThrow(FileChangedError);
  });

  it('createOnly：新建成功；已存在时不覆盖且不丢原文件', () => {
    const dst = join(tmp, 'create-only.ptr');
    const loaded = loadDoc(join(fixtures, 'basic.pen'));
    saveDoc(dst, loaded.doc, { flavor: 'ptr', createOnly: true });
    const before = readFileSync(dst, 'utf8');
    const changed = structuredClone(loaded.doc);
    changed.variables = {};
    expect(() => saveDoc(dst, changed, { flavor: 'ptr', createOnly: true })).toThrow(/已存在/);
    expect(readFileSync(dst, 'utf8')).toBe(before);
  });

  it('备份先行：覆盖前旧内容落备份目录', () => {
    const dir = join(tmp, 'backups');
    mkdirSync(dir, { recursive: true });
    const dst = join(tmp, 'backed.pen');
    const loaded = loadDoc(join(fixtures, 'basic.pen'));
    saveDoc(dst, loaded.doc, { flavor: 'pen' });
    const original = readFileSync(dst, 'utf8');
    const reloaded = loadDoc(dst);
    reloaded.doc.variables = undefined;
    saveDoc(dst, reloaded.doc, { flavor: 'pen', expectedMtimeMs: reloaded.mtimeMs, backupDir: dir });
    expect(readFileSync(join(dir, 'backed.pen'), 'utf8')).toBe(original);
  });
});
