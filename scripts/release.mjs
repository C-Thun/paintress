#!/usr/bin/env node
/**
 * 一条命令发版：`pnpm release <major|minor|patch>`。
 *
 * 发版语义与 pi-toolkits 一致：**tag 是发版意图，CI 是发版执行**。
 * 本脚本只做「准备 + 推 tag」，`.github/workflows/publish.yml` 被 `v*` tag
 * 触发后用 OIDC trusted publishing 发布（无 token、无 2FA、自带 provenance）。
 * 推 tag 成功 ≠ 发版成功 —— 脚本会盯着 CI 与 registry，确认版本真的在 npm 上。
 *
 * 流程：
 *   校验参数 → 工作区必须干净 → 分支必须是默认分支 → tag 未被占用
 *   → typecheck（服务端 + ui）/ test / build / verify:pkg
 *   → bump package.json → commit `chore(release): vX.Y.Z` → tag `vX.Y.Z`
 *   → push 分支 + tag（这一步才是发版动作）
 *   → 轮询 CI 与 npm，确认版本已发布（失败/超时如实报告）
 *
 * 用法：
 *   pnpm release patch              # 0.3.1 → 0.3.2
 *   pnpm release minor              # 0.3.1 → 0.4.0
 *   pnpm release major              # 0.3.1 → 1.0.0
 *   pnpm release patch --dry-run    # 只打印计划，不改任何东西
 *   pnpm release patch --prepare-only   # 提交 + 打 tag 后停下，不 push
 *   pnpm release patch --no-wait    # 推完就返回，不盯 CI
 *   pnpm release patch --allow-branch   # 允许在非默认分支上发（应急）
 *   pnpm release patch --local      # 应急：本机直接 npm publish（需 token）
 *
 * 注意：`--local` 绕过了 CI 的 tag 校验与 provenance，只在 CI 不可用时使用；
 * 2027-01 起绕过 2FA 的 granular token 失效，届时必须回到 tag + CI 路径。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_PATH = join(ROOT, 'package.json');
const BUMPS = ['major', 'minor', 'patch'];
const FLAGS = new Set(['--dry-run', '--prepare-only', '--no-wait', '--allow-branch', '--local']);

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
};
const paint = (code, text) => `${code}${text}${C.reset}`;
const step = (text) => console.log(`\n${paint(C.bold, `▶ ${text}`)}`);
const note = (text) => console.log(`  ${paint(C.dim, text)}`);
const ok = (text) => console.log(`  ${paint(C.green, '✓')} ${text}`);
const warn = (text) => console.log(`  ${paint(C.yellow, '!')} ${text}`);

class Abort extends Error {
  constructor(message) {
    super(message);
    this.name = 'Abort';
  }
}

/** JSON 解析失败要变成可读的 abort，而不是裸 SyntaxError */
function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Abort(`${what} 不是合法 JSON：${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** 跑子进程；capture=false 时直接透传 stdio（跑测试/构建用） */
function run(cmd, args, { capture = false, allowFail = false } = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    timeout: 15 * 60_000,
  });
  if (res.error) throw new Abort(`${cmd} 执行失败：${res.error.message}`);
  if (res.status !== 0 && !allowFail) {
    const tail = capture ? (res.stderr || res.stdout || '').trim() : '';
    throw new Abort(`${cmd} ${args.join(' ')} 退出码 ${res.status}${tail ? `\n${tail}` : ''}`);
  }
  return { status: res.status, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim() };
}

function parseArgs(argv) {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  for (const flag of flags) {
    if (!FLAGS.has(flag)) throw new Abort(`未知参数：${flag}（可用：${[...FLAGS].join(' ')}）`);
  }
  if (positional.length !== 1 || !BUMPS.includes(positional[0])) {
    throw new Abort(`用法：pnpm release <${BUMPS.join('|')}> [--dry-run] [--prepare-only] [--no-wait] [--local]`);
  }
  return { bump: positional[0], flags };
}

/** 高位进位时低位清零：1.2.3 minor → 1.3.0 */
export function nextVersion(current, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) throw new Abort(`当前版本不是 x.y.z：${current}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function readVersion() {
  const raw = readFileSync(PKG_PATH, 'utf8');
  const version = parseJson(raw, 'package.json').version;
  if (typeof version !== 'string') throw new Abort('package.json 缺少 version');
  return { raw, version };
}

/** 只替换顶层 version 值，保持文件原有格式（不重新序列化） */
function writeVersion(raw, from, to) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`("version"\\s*:\\s*")${escaped}(")`);
  if (!pattern.test(raw)) throw new Abort(`package.json 里找不到 version: ${from}`);
  const next = raw.replace(pattern, `$1${to}$2`);
  if (parseJson(next, '替换后的 package.json').version !== to) throw new Abort('版本替换后自检失败，已中止');
  writeFileSync(PKG_PATH, next, 'utf8');
}

function gitOutput(args) {
  return run('git', args, { capture: true }).stdout;
}

function assertClean() {
  const dirty = gitOutput(['status', '--porcelain']);
  if (dirty !== '') {
    throw new Abort(`工作区不干净，发版提交会混入无关改动：\n${dirty}\n先提交或 stash 再发。`);
  }
}

function currentBranch() {
  return gitOutput(['rev-parse', '--abbrev-ref', 'HEAD']);
}

function defaultBranch() {
  // origin/HEAD 指向远端默认分支；没有远端时退回 master
  const res = run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { capture: true, allowFail: true });
  if (res.status !== 0) return 'master';
  return res.stdout.replace(/^origin\//, '');
}

function tagExists(tag) {
  if (run('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { capture: true, allowFail: true }).status === 0) {
    return 'local';
  }
  const remote = run('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`], { capture: true, allowFail: true });
  if (remote.status === 0) return 'remote';
  return null;
}

function parseRepo() {
  const url = run('git', ['remote', 'get-url', 'origin'], { capture: true, allowFail: true }).stdout;
  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

const GATES = [
  ['类型检查（服务端）', 'pnpm', ['check']],
  ['类型检查（ui）', 'pnpm', ['--dir', 'ui', 'typecheck']],
  ['测试', 'pnpm', ['test']],
  ['构建', 'pnpm', ['build']],
  ['包内容自检', 'pnpm', ['verify:pkg']],
];

function runGates() {
  for (const [label, cmd, args] of GATES) {
    step(label);
    run(cmd, args);
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** registry 上是否已有该版本（1xx/2xx = 有） */
async function publishedOnNpm(name, version) {
  const res = await fetch(`https://registry.npmjs.org/${name}/${version}`, {
    headers: { accept: 'application/json' },
  }).catch(() => null);
  return res !== null && res.ok;
}

/** 该 commit 触发的最新 publish workflow run（公开仓库无需 token；有 token 时用上避免限流） */
async function findPublishRun(repo, sha) {
  if (!repo) return undefined;
  const token = process.env['GITHUB_TOKEN'];
  const headers = { accept: 'application/vnd.github+json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/runs?head_sha=${sha}&per_page=20`,
    { headers },
  ).catch(() => null);
  if (res === null || !res.ok) return undefined;
  const data = await res.json().catch(() => null);
  const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
  const mine = runs.filter((entry) => entry.path?.endsWith('publish.yml') && entry.head_sha === sha);
  return mine.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
}

const BAD_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure']);

/** CI run 的一句话状态 */
function describeRun(run) {
  if (!run) return 'CI run 尚未出现';
  return `CI ${run.status}${run.conclusion ? ` / ${run.conclusion}` : ''} — ${run.html_url}`;
}

async function waitForPublish({ name, version, repo, sha }) {
  step('等待 CI 发布');
  const started = Date.now();
  const timeoutMs = 15 * 60_000;
  let run;
  let lastNote = 0;
  for (;;) {
    if (await publishedOnNpm(name, version)) {
      ok(`${name}@${version} 已在 npm 上`);
      return { run };
    }
    run = (await findPublishRun(repo, sha)) ?? run;
    if (run && BAD_CONCLUSIONS.has(run.conclusion)) {
      throw new Abort(`CI 发布失败（${run.conclusion}）：${run.html_url}`);
    }
    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) {
      throw new Abort(
        `等待发布超时（${Math.round(elapsed / 1000)}s）：registry 上还没有 ${name}@${version}\n${describeRun(run)}`,
      );
    }
    if (Date.now() - lastNote > 30_000) {
      lastNote = Date.now();
      note(describeRun(run));
    }
    await sleep(5000);
  }
}

async function main() {
  const { bump, flags } = parseArgs(process.argv.slice(2));
  const { raw, version } = readVersion();
  const next = nextVersion(version, bump);
  const tag = `v${next}`;
  const name = parseJson(raw, 'package.json').name;
  const repo = parseRepo();
  const dryRun = flags.has('--dry-run');

  console.log(`\n${paint(C.bold, `${name} 发版`)}  ${version} → ${paint(C.bold, next)}  （tag ${tag}）`);
  if (dryRun) {
    console.log(`\n${paint(C.yellow, '--dry-run：只打印计划，不做任何改动')}`);
    for (const [label] of GATES) note(`会执行 ${label}`);
    note('会提交 chore(release) 并打 tag，然后 push 触发 CI');
    return;
  }

  step('检查前置条件');
  assertClean();
  ok('工作区干净');
  const branch = currentBranch();
  const base = defaultBranch();
  if (branch !== base) {
    if (!flags.has('--allow-branch')) {
      throw new Abort(`当前分支 ${branch} 不是默认分支 ${base}（确需如此加 --allow-branch）`);
    }
    warn(`在非默认分支 ${branch} 上发版`);
  } else {
    ok(`分支 ${branch}`);
  }
  const taken = tagExists(tag);
  if (taken === 'local') throw new Abort(`本地已存在 tag ${tag}`);
  if (taken === 'remote') throw new Abort(`远端已存在 tag ${tag}`);
  ok(`tag ${tag} 可用`);

  runGates();

  step(`写入版本 ${next}`);
  writeVersion(raw, version, next);
  ok('package.json 已更新');

  step('提交并打 tag');
  run('git', ['add', 'package.json']);
  run('git', ['commit', '-m', `chore(release): ${tag}`]);
  run('git', ['tag', '-a', tag, '-m', `${name} ${tag}`]);
  ok(`已提交并打 tag ${tag}`);

  if (flags.has('--prepare-only')) {
    console.log(`\n${paint(C.yellow, '--prepare-only：已停在本地，推上去才发版：')}`);
    console.log(`  git push origin ${branch} && git push origin ${tag}`);
    return;
  }

  if (flags.has('--local')) {
    step('本机直接发布（应急路径）');
    warn('绕过 CI 的 tag 校验与 provenance；仅在 CI 不可用时使用');
    run('npm', ['publish', '--access', 'public']);
    ok(`${name}@${next} 已发布`);
    console.log(`\n别忘了把提交与 tag 推上去：git push origin ${branch} && git push origin ${tag}`);
    return;
  }

  step('推送触发 CI');
  run('git', ['push', 'origin', branch]);
  run('git', ['push', 'origin', tag]);
  ok('tag 已推送，CI 开始发布');

  const sha = gitOutput(['rev-parse', 'HEAD']);

  if (flags.has('--no-wait')) {
    console.log(`\n${paint(C.yellow, '--no-wait：不盯 CI。稍后自行确认：')}`);
    console.log(`  npm view ${name}@${next} version`);
    return;
  }

  const { run: workflow } = await waitForPublish({ name, version: next, repo, sha });
  console.log(`\n${paint(C.green, `发布完成：${name}@${next}`)}`);
  if (workflow?.html_url) note(`CI：${workflow.html_url}`);
  const attestations = await fetch(`https://registry.npmjs.org/${name}/${next}`, { headers: { accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  if (attestations?.dist?.attestations) ok('provenance attestation 存在');
  else warn('registry 上暂未看到 provenance attestation（可能在索引中，稍后复核）');
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((cause) => {
    const message = cause instanceof Abort ? cause.message : (cause?.stack ?? String(cause));
    console.error(`\n${paint(C.red, '发版中止')}：${message}`);
    process.exit(1);
  });
}
