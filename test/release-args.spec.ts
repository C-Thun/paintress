import { describe, expect, it } from 'vitest';
import { parseArgs } from '../scripts/release.mjs';

/**
 * 发版脚本的参数契约。
 * `--retag` 是 CI 失败后的恢复路径：它不 bump 版本，只把「已推送、未发布」的 tag 移到当前提交，
 * 所以参数组合必须收窄 —— 否则很容易被当成普通发版跑出意外结果。
 */
describe('发版参数解析', () => {
  it('正常发版：一个 bump 位', () => {
    expect(parseArgs(['patch'])).toMatchObject({ bump: 'patch' });
    expect(parseArgs(['minor']).bump).toBe('minor');
  });

  it('--retag 不带版本位，bump 为 null', () => {
    const parsed = parseArgs(['--retag']);
    expect(parsed.bump).toBeNull();
    expect(parsed.flags.has('--retag')).toBe(true);
  });

  it('--retag 与版本位互斥（它不发新版）', () => {
    expect(() => parseArgs(['patch', '--retag'])).toThrow(/不接受版本位/);
  });

  it('--retag 与 --local 互斥（--local 不走 tag）', () => {
    expect(() => parseArgs(['--retag', '--local'])).toThrow(/不能和 --local/);
  });

  it('未知参数与缺少版本位都报错', () => {
    expect(() => parseArgs(['patch', '--nope'])).toThrow(/未知参数/);
    expect(() => parseArgs([])).toThrow(/用法/);
    expect(() => parseArgs(['huge'])).toThrow(/用法/);
  });
});
