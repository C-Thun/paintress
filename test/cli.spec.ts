import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isDirectExecution, parseArgv, main } from '../src/cli.js';

describe('parseArgv', () => {
  it('子命令 + 位置参数', () => {
    expect(parseArgv(['get', 'a.pen', 'title'])).toEqual({
      cmd: 'get',
      positionals: ['a.pen', 'title'],
      flags: {},
    });
  });

  it('字符串标志吃掉下一个 token', () => {
    expect(parseArgv(['query', 'a.pen', '--type', 'text'])?.flags).toEqual({ type: 'text' });
  });

  it('布尔标志不吃 token', () => {
    expect(parseArgv(['query', 'a.pen', '--reusable', 'x'])?.positionals).toEqual(['a.pen', 'x']);
  });

  it('dry-run 在客户端名前仍是布尔值，不吞位置参数', () => {
    expect(parseArgv(['install', '--dry-run', 'pi'])).toEqual({
      cmd: 'install',
      positionals: ['pi'],
      flags: { 'dry-run': true },
    });
  });

  it('未知标志返回 null', () => {
    expect(parseArgv(['query', 'a.pen', '--bogus'])).toBeNull();
  });

  it('空参数返回 null', () => {
    expect(parseArgv([])).toBeNull();
  });
});

describe('bin 直接执行判定', () => {
  it('npm 的 bin 符号链接指向当前模块 → true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paintress-bin-'));
    const link = join(dir, 'paintress');
    symlinkSync(fileURLToPath(new URL('../src/cli.ts', import.meta.url)), link);
    try {
      expect(isDirectExecution(link)).toBe(true);
      expect(isDirectExecution(join(dir, 'missing.js'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('main 冒烟（临时副本）', () => {
  let tmp: string;
  let file: string;
  let log: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'paintress-cli-'));
    file = join(tmp, 'w.pen');
    copyFileSync(join(import.meta.dirname, 'fixtures/basic.pen'), file);
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => {
    log.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('get 输出节点 JSON，退出码 0', async () => {
    const code = await main(['get', file, 'title']);
    expect(code).toBe(0);
    const printed = log.mock.calls.at(-1)?.[0] as string;
    const node = JSON.parse(printed) as { node: { id: string; content: string } };
    expect(node['node']).toMatchObject({ id: 'title', content: 'Paintress' });
  });

  it('update 落盘，get 复读一致', async () => {
    expect(await main(['update', file, 'title', '{"content":"CLI 改的"}'])).toBe(0);
    expect(await main(['get', file, 'title'])).toBe(0);
    const printed = log.mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(printed)['node']).toMatchObject({ content: 'CLI 改的' });
    // 磁盘上真的变了
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as { children: { children: { id: string; content: string }[] }[] };
    const title = onDisk.children[0]?.children.find((c) => c.id === 'title');
    expect(title?.content).toBe('CLI 改的');
  });

  it('错误路径：退出码 1', async () => {
    expect(await main(['get', file, '没有这个'])).toBe(1);
    expect(await main(['bogus-cmd', file])).toBe(2);
    expect(await main([])).toBe(2);
  });

  it('watch 参数齐全时进入实际流程（不再误报用法）', async () => {
    const errs = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).join('\n');
    const code = await main(['watch', 'demo', '/tmp/whatever']);
    expect(errs).not.toContain('用法：paintress watch');
    // 无 daemon 时应为连接错误（1），而非用法错误（2）
    expect([0, 1]).toContain(code);
  });

  it('attach/unwatch 同理：缺参数才报用法', async () => {
    expect(await main(['attach'])).toBe(1);
    expect(await main(['unwatch'])).toBe(1);
  });
});
