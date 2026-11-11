import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 包版本：运行时从 package.json 读取，避免在多处硬编码后忘记同步。
 *
 * 路径要覆盖两种布局：
 * - 构建产物 `dist/cli.js`、`dist/index.js` → `../package.json`
 * - 构建产物 `dist/mcp/server.js` 与源码 `src/shared/version.ts` → `../../package.json`
 */
function readPackageVersion(): string {
  for (const rel of ['../package.json', '../../package.json']) {
    try {
      const raw = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === 'string' && version !== '') return version;
    } catch {
      /* 试下一个候选路径 */
    }
  }
  return '0.0.0';
}

export const VERSION = readPackageVersion();
