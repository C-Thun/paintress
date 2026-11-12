import { describe, expect, it } from 'vitest';
import { compareVersions, isNewer } from '../src/shared/version-compare.js';
import { VersionChecker, fetchLatestVersion, shouldRefresh, type LatestVersionState } from '../src/web/update-check.js';

describe('版本比较（查看器升级提示的判断依据）', () => {
  it('逐段数值比较，不看字典序', () => {
    expect(compareVersions('0.4.0', '0.3.9')).toBe(1); // 字典序会判错
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.3.0', '0.4.0')).toBe(-1);
  });

  it('容忍 v 前缀与残缺段', () => {
    expect(compareVersions('v0.4.0', '0.4')).toBe(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.1', '1.2')).toBe(1);
  });

  it('主版本相同时预发布低于正式版', () => {
    expect(compareVersions('0.2.0-rc.1', '0.2.0')).toBe(-1);
    expect(isNewer('0.2.0', '0.2.0-rc.1')).toBe(true);
    expect(isNewer('0.2.0-rc.2', '0.2.0-rc.1')).toBe(false); // 不拿 beta 之间比大小
  });

  it('isNewer 只认严格更新', () => {
    expect(isNewer('0.4.0', '0.4.0')).toBe(false);
    expect(isNewer('0.5.0', '0.4.0')).toBe(true);
  });
});

describe('升级探测的缓存策略', () => {
  const ok: LatestVersionState = { version: '0.5.0', checkedAt: 0 };
  const failed: LatestVersionState = { version: null, checkedAt: 0 };

  it('无缓存必刷新', () => {
    expect(shouldRefresh(null)).toBe(true);
  });

  it('成功结果缓存 6 小时', () => {
    expect(shouldRefresh(ok, 5 * 3_600_000)).toBe(false);
    expect(shouldRefresh(ok, 7 * 3_600_000)).toBe(true);
  });

  it('失败只缓存 10 分钟（断网不压住一整天的探测）', () => {
    expect(shouldRefresh(failed, 5 * 60_000)).toBe(false);
    expect(shouldRefresh(failed, 11 * 60_000)).toBe(true);
  });
});

describe('fetchLatestVersion 的失败静默', () => {
  it('200 + version → 返回版本号', async () => {
    const fake = (async () => new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 })) as unknown as typeof fetch;
    expect(await fetchLatestVersion(fake, 100)).toBe('9.9.9');
  });

  it('非 200 / 坏 JSON / 抛错 / 缺字段 → 一律 null，不抛', async () => {
    const notFound = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchLatestVersion(notFound, 100)).toBeNull();

    const broken = (async () => new Response('{not json', { status: 200 })) as unknown as typeof fetch;
    expect(await fetchLatestVersion(broken, 100)).toBeNull();

    const throwing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchLatestVersion(throwing, 100)).toBeNull();

    const empty = (async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;
    expect(await fetchLatestVersion(empty, 100)).toBeNull();
  });
});

describe('VersionChecker 非阻塞', () => {
  it('peek 立即返回旧值，后台完成刷新', async () => {
    let resolve: (v: string | null) => void = () => {};
    const checker = new VersionChecker(() => new Promise<string | null>((r) => (resolve = r)));
    expect(checker.peek()).toBeNull(); // 首次调用不等网络
    expect(checker.latest).toBeNull();
    resolve('1.0.0');
    await new Promise((r) => setTimeout(r, 0));
    expect(checker.latest).toBe('1.0.0');
  });

  it('缓存有效期内不重复请求', async () => {
    let calls = 0;
    const checker = new VersionChecker(async () => {
      calls += 1;
      return '1.2.3';
    });
    checker.peek();
    await new Promise((r) => setTimeout(r, 0));
    checker.peek();
    checker.peek();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
  });
});
