import { describe, expect, it } from 'vitest';
import { bumpManifest, parseArgs } from '../scripts/release.mjs';

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

describe('server.json 版本跟随 package.json', () => {
  it('顶层 version 与每个 packages[].version 一起更新，其他字段原样保留', () => {
    const raw = JSON.stringify(
      {
        $schema: 'https://example.test/server.schema.json',
        name: 'io.github.aliciai-dev/paintress',
        version: '0.5.2',
        packages: [
          { registryType: 'npm', identifier: 'paintress', version: '0.5.2' },
          { registryType: 'oci', identifier: 'example/paintress:0.5.2', version: '0.5.2' },
        ],
      },
      null,
      2,
    );
    const next = JSON.parse(bumpManifest(raw, '0.6.0')) as {
      name: string;
      version: string;
      packages: { version: string; identifier: string }[];
    };
    expect(next.version).toBe('0.6.0');
    expect(next.packages.map((p) => p.version)).toEqual(['0.6.0', '0.6.0']);
    expect(next.name).toBe('io.github.aliciai-dev/paintress');
    // 只改版本位，不动 identifier 里的版本串（那是包名/镜像标签，不是清单版本）
    expect(next.packages[1]?.identifier).toBe('example/paintress:0.5.2');
  });

  it('缺少 version 时中止，而不是写出半截清单', () => {
    expect(() => bumpManifest(JSON.stringify({ name: 'x' }), '0.6.0')).toThrow(/server\.json 缺少 version/);
  });
});
