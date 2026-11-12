/**
 * 版本升级探测：查 npm registry 的 latest 版本号。
 *
 * 策略（FUTURE.md#变更高亮柔化与版本升级提示）：
 * - **失败静默**：查看器是本地工具，npm 不可达时不能变慢、不能报错，保持现状即可；
 * - 成功缓存 6 小时，失败只缓存 10 分钟（别把一次断网记成「一整天没有新版」）；
 * - 调用方永远拿上次结果，刷新在后台进行（绝不阻塞 HTTP 响应）。
 */

export interface LatestVersionState {
  version: string | null;
  checkedAt: number;
}

const OK_TTL_MS = 6 * 60 * 60_000;
const FAIL_TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 3000;
const REGISTRY_URL = 'https://registry.npmjs.org/paintress/latest';

/** 当前缓存是否已经过期（没有缓存也算过期） */
export function shouldRefresh(state: LatestVersionState | null, now = Date.now()): boolean {
  if (state === null) return true;
  const ttl = state.version === null ? FAIL_TTL_MS : OK_TTL_MS;
  return now - state.checkedAt >= ttl;
}

/** 查一次 npm；任何失败（离线 / 超时 / 404 / 坏 JSON）都返回 null，不抛 */
export async function fetchLatestVersion(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<string | null> {
  try {
    const res = await fetchImpl(REGISTRY_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === 'string' && body.version !== '' ? body.version : null;
  } catch {
    return null;
  }
}

export class VersionChecker {
  private state: LatestVersionState | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly fetcher: () => Promise<string | null> = () => fetchLatestVersion()) {}

  /** 已完成探测的最新版号（没查到为 null） */
  get latest(): string | null {
    return this.state?.version ?? null;
  }

  /** 读当前值并在后台刷新（不阻塞调用方） */
  peek(): string | null {
    if (shouldRefresh(this.state) && this.inFlight === null) {
      const task = this.refresh().finally(() => {
        this.inFlight = null;
      });
      this.inFlight = task;
      void task;
    }
    return this.latest;
  }

  private async refresh(): Promise<void> {
    const version = await this.fetcher();
    this.state = { version, checkedAt: Date.now() };
  }
}
