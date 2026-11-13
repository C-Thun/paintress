/**
 * `scripts/release.mjs` 的类型声明（脚本本身是纯 JS，不参与构建）。
 * 测试（test/release-args.spec.ts）通过它拿到参数契约的类型。
 */
export type Bump = 'major' | 'minor' | 'patch';

export interface ParsedArgs {
  /** `--retag` 不 bump 版本，所以可能是 null */
  bump: Bump | null;
  flags: Set<string>;
}

export function parseArgs(argv: string[]): ParsedArgs;

export function nextVersion(current: string, bump: Bump): string;

/** server.json 清单的版本跟随 package.json（顶层 + 每个 packages[].version） */
export function bumpManifest(raw: string, to: string): string;
