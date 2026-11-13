import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startDaemon, type DaemonHandle } from '../src/web/daemon.js';
import { queryDaemon, sendRequest } from '../src/web/client.js';
import { ensureDaemon, reuseDaemon } from '../src/web/spawn.js';
import { closeViewerHandles, ensureViewer } from '../src/web/autoregister.js';
import { TOOLS } from '../src/mcp/tools.js';
import { main } from '../src/cli.js';

/**
 * 「开始作画前先把 web 拉起来」能无条件调用的前提：这条路径必须幂等。
 * 这里把 daemon 起在临时 PAINTRESS_HOME 里（端口 0），验证：
 * 已有实例 → 复用（不起第二个进程）；项目 → 只注册一次；CLI → 前台/后台都复用。
 */

let home: string;
let projectDir: string;
let daemon: DaemonHandle;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'paintress-ensure-'));
  process.env['PAINTRESS_HOME'] = home;
  projectDir = mkdtempSync(join(tmpdir(), 'paintress-ensure-proj-'));
  daemon = await startDaemon({ port: 0, idleTimeoutMs: 10 * 60_000, idleCheckMs: 5_000, quiet: true });
});

afterAll(async () => {
  closeViewerHandles();
  await daemon.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
  delete process.env['PAINTRESS_HOME'];
});

describe('幂等判据', () => {
  it('ping 带上端口，queryDaemon 给出 pid/端口', async () => {
    const info = await queryDaemon();
    expect(info).not.toBeNull();
    expect(info?.pid).toBe(daemon.pid);
    expect(info?.port).toBe(daemon.port);
  });

  it('ensureDaemon 复用已有实例：started=false，pid/端口不变', async () => {
    const res = await ensureDaemon();
    expect(res).toEqual({ started: false, pid: daemon.pid, port: daemon.port });
  });

  it('reuseDaemon：同端口复用，指定了别的端口则明确报错', async () => {
    expect((await reuseDaemon(daemon.port))?.pid).toBe(daemon.pid);
    await expect(reuseDaemon(daemon.port + 1)).rejects.toThrow(/端口/);
  });
});

describe('ensureViewer', () => {
  it('注册项目并返回深链；重复调用不重复注册、不换进程', async () => {
    const first = await ensureViewer({ dir: projectDir });
    expect(first.startedDaemon).toBe(false);
    expect(first.pid).toBe(daemon.pid);
    expect(first.url).toBe(`http://localhost:${daemon.port}/${first.project}`);

    const second = await ensureViewer({ dir: projectDir });
    expect(second.project).toBe(first.project);
    expect(second.pid).toBe(daemon.pid);
    expect(second.startedDaemon).toBe(false);

    const status = await sendRequest({ kind: 'status' });
    expect(status.ok).toBe(true);
    if (status.ok && 'version' in status) {
      const entries = status.projects.filter((p) => p.name === first.project);
      expect(entries).toHaveLength(1);
      // 只持有一条 attach 连接：重复 ensure 不会把 agent 连接数堆上去
      expect(entries[0]?.agentConns).toBe(1);
    }
  });

  it('MCP 工具 paintress_viewer 走同一条幂等路径，返回可打开的 URL', async () => {
    const out = (await TOOLS['paintress_viewer']!.run({ dir: projectDir })) as Record<string, unknown>;
    expect(out['ok']).toBe(true);
    expect(out['started']).toBe(false);
    expect(out['pid']).toBe(daemon.pid);
    expect(String(out['url'])).toBe(`http://localhost:${daemon.port}/${String(out['project'])}`);
  });

  it('连接释放后 daemon 看到 agent 归零', async () => {
    const info = await ensureViewer({ dir: projectDir });
    closeViewerHandles();
    const status = await sendRequest({ kind: 'status' });
    if (status.ok && 'version' in status) {
      expect(status.projects.find((p) => p.name === info.project)?.agentConns).toBe(0);
    }
  });
});

describe('CLI web 幂等', () => {
  async function run(argv: string[]): Promise<{ code: number; out: string }> {
    const chunks: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((v: unknown) => void chunks.push(String(v)));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const code = await main(argv);
      return { code, out: chunks.join('') };
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  }

  it('前台 paintress web：已有实例时立即复用并退出 0', async () => {
    const { code, out } = await run(['web']);
    expect(code).toBe(0);
    const res = JSON.parse(out) as { reused: boolean; pid: number; port: number };
    expect(res.reused).toBe(true);
    expect(res.pid).toBe(daemon.pid);
    expect(res.port).toBe(daemon.port);
  });

  it('paintress web --daemon：同样复用，不起第二个进程', async () => {
    const { code, out } = await run(['web', '--daemon']);
    expect(code).toBe(0);
    const res = JSON.parse(out) as { daemon: boolean; reused: boolean; pid: number; http: string };
    expect(res.daemon).toBe(true);
    expect(res.reused).toBe(true);
    expect(res.pid).toBe(daemon.pid);
    expect(res.http).toBe(`http://localhost:${daemon.port}`);
  });

  it('--port 与运行中的不一致时明确报错，不静默忽略', async () => {
    const { code, out } = await run(['web', '--daemon', '--port', String(daemon.port + 1)]);
    expect(code).toBe(1);
    expect(out).toBe('');
  });
});
