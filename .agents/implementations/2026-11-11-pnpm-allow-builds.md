# pnpm 构建白名单字段失效（2026-11-11）

- 现象：全新 clone 后 `pnpm install --frozen-lockfile` **退出码 1**：
  `ERR_PNPM_IGNORED_BUILDS ╰─▶ Ignored build scripts: esbuild@0.28.2`。
  旧目录里旧版 node_modules 早已装好，所以这个失败只在「全新安装」时暴露——迁移到新 clone 才第一次被看到。
- 根因：`pnpm-workspace.yaml` 里写的是 `onlyBuiltDependencies: [esbuild]`。该字段在 **pnpm 11 起被 `allowBuilds` 取代**，之后**被静默忽略**（不报“未知配置”，只是不再生效）；pnpm 12 默认 `strictDepBuilds: true`，于是有构建脚本的依赖没被明确批准就失败。
  - 依据：https://pnpm.io/settings/build 、https://pnpm.io/cli/approve-builds 、pnpm/pnpm#13849（`approve-builds` 会清理这四个遗留字段）。
- 修复（`pnpm-workspace.yaml`）：

  ```yaml
  allowBuilds:
    esbuild: true
  ```

- 证据（2026-11-11，`rm -rf node_modules ui/node_modules` 后重来）：

  ```text
  pnpm install --frozen-lockfile   → exit 0（238 包，store 全命中）
  pnpm build                       → exit 0（tsdown + vite 均过）
  pnpm test                        → 9 文件 117 用例全绿
  ```

- 备注：esbuild 的 postinstall 即使被跳过，vite 8 仍能用（二进制来自可选依赖 `@esbuild/linux-x64`），所以这个坑不会以“构建失败”的形式提示你，只会以 install 退出码 1 的形式存在——CI 或别的机器上第一次装就会红。
