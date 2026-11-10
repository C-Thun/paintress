# 仓库迁移：C-Thun/paintress → aliciai-dev/paintress（2026-11-11）

- 范围：把仓库从 `C-Thun/paintress` 迁到 `aliciai-dev/paintress`（org 由 operator 新建，见 `ARCHITECTURE.md#D-005`），并把本地工作目录迁到与 org 对齐的新路径。
- 决策依据：远端当时只有 `Initial commit`（LICENSE + README），无 issue/PR/tag/LFS/submodule/Actions；真正历史全在本地。选 **GitHub Transfer repository** 而非「新建仓库 + push」，为的是拿到旧地址自动重定向（Transfer 后 `C-Thun/paintress` 的网页与 git 地址均跳转到新仓库，实测 `gh api repos/C-Thun/paintress` 返回 `aliciai-dev/paintress`）。

## 步骤

1. 先 `git push origin master` —— Transfer 搬的是 GitHub 端状态，不搬磁盘，本地 13 个未推送 commit 必须先上网。
2. 网页 Transfer（Danger Zone → Transfer → `aliciai-dev`）；**Transfer 前不能在目标 org 预先创建同名仓库**，否则占用名字导致转移失败。
3. `git clone git@github.com:aliciai-dev/paintress.git` 到新目录，校验通过后会话切过去，旧目录保留待删。
4. 校验后再 `pnpm install` / `build` / `test` 重建本地产物。

## 证据（2026-11-11）

```text
# 迁移前：本地领先远端
origin/master = fbec67d "Initial commit"      （远端仅 1 个 commit）
master        = 98b56c3                        （本地 14 个 commit，ahead 13）

# Transfer 后
gh api repos/C-Thun/paintress -q .full_name   → aliciai-dev/paintress   （重定向生效）
gh api repos/aliciai-dev/paintress            → public, default_branch=master

# 新 clone 校验
git rev-list --count HEAD                      → 14
git rev-parse HEAD origin/master               → 两值相同（98b56c3）
git ls-files | wc -l                           → 83（与迁移前一致）

# 重建
pnpm install --frozen-lockfile                 → exit 0
pnpm build                                     → exit 0（dist/cli.js 56.29 kB + ui/dist 22.14 kB）
pnpm test                                      → 9 文件 117 用例全绿
```

## 路径字符串更新（记忆契约 rule 4 的例外，逐条列出）

- `.agents/framework/plans/plan-2026-11-10T02-16-33-08-00.json` 与 `.agents/framework/snapshots/2026-11-10T02-16-33-08-00/manifest.json` 内含旧绝对路径。两者均被 `.agents/framework/.gitignore` 忽略、由框架重新生成，**未手工改写**（改也无意义：内容指向的是旧会话快照）。
- 追踪文件里唯一提到旧 org 的是 `ARCHITECTURE.md#D-005` 的后果段，已改为既成事实表述。`git grep -i "c-thun"` 现只剩该段落的历史引述（旧地址作为重定向来源保留说明）。

## 顺带修复 / 遗留

- 顺带修复：`pnpm-workspace.yaml` 的构建白名单字段失效，见 `.agents/implementations/2026-11-11-pnpm-allow-builds.md`。
- `package.json` 增加 `repository` 字段指向新地址（npm provenance 需要）。
- 未做：旧目录 `rm`（待观察期结束）、GitHub 仓库 Description/Topics、npm 包名（`FUTURE.md#阶段 5` 待定）。
