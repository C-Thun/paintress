/**
 * 语义化版本比较——只服务于「有没有新版可用」这一个判断，不追求 semver 全量语义。
 *
 * 放在独立的 shared 模块（不引 node:fs），因为查看器前端也要用：
 * `src/shared/version.ts` 会读 package.json，进不了浏览器包。
 */

/** 解析成 [major, minor, patch] 与是否有预发布后缀 */
function parse(v: string): { nums: number[]; prerelease: boolean } {
  const trimmed = v.trim().replace(/^v/i, '');
  const dash = trimmed.indexOf('-');
  const core = dash >= 0 ? trimmed.slice(0, dash) : trimmed;
  const nums = core.split('.').map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
  return { nums, prerelease: dash >= 0 };
}

/** a > b → 1，a < b → -1；主版本相同且预发布状态相同 → 0（不比较 rc 序号） */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  const len = Math.max(left.nums.length, right.nums.length);
  for (let i = 0; i < len; i += 1) {
    const x = left.nums[i] ?? 0;
    const y = right.nums[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  // 主版本相同：预发布 < 正式（0.2.0-rc.1 < 0.2.0）
  if (left.prerelease !== right.prerelease) return left.prerelease ? -1 : 1;
  return 0;
}

/** 上游版本比当前版本新（用于「显示升级提示」的判断） */
export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}
