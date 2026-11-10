import { defineConfig } from 'tsdown/config';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/mcp/server.ts'],
  format: 'esm',
  target: 'node22',
  // dts 暂关：zod passthrough 推断类型超过 TS 序列化上限（TS7056）。
  // 发布前给导出 schema 加显式注解后恢复。见 specs/PLAN.md 未决问题。
  dts: false,
});
