import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDaemon, type DaemonHandle } from '../src/web/daemon.js';
import { attachPersistent, isDaemonRunning, sendRequest } from '../src/web/client.js';

/**
 * 项目解绑线：自动退场（agent 退出后的宽限期）+ web 手动解绑 + 关闭进程。
 * 宽限期压到 400ms，让用例能在秒级内验证「宽限期内还在 → 超时后退场」。
 */

const GRACE_MS = 400;

let home: string;
let projectDir: string;
let daemon: DaemonHandle;
let baseUrl: string;

async function names(): Promise<string[]> {
  const res = (await (await fetch(`${baseUrl}/api/projects`)).json()) as { projects: { name: string }[] };
  return res.projects.map((p) => p.name);
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`等待超时（${timeoutMs}ms）`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 把 SSE 读到结束；进程真正关闭连接时 done/catch 都会走到 finally */
function monitorStreamClose(res: Response, onClose: () => void): void {
  void (async () => {
    try {
      const reader = res.body!.getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      /* 连接被 daemon 主动断开也算关闭 */
    } finally {
      onClose();
    }
  })();
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'paintress-detach-'));
  process.env['PAINTRESS_HOME'] = home;
  projectDir = mkdtempSync(join(tmpdir(), 'paintress-detach-proj-'));
  copyFileSync(join(import.meta.dirname, 'fixtures/basic.pen'), join(projectDir, 'design.pen'));
  daemon = await startDaemon({
    port: 0,
    idleTimeoutMs: 10 * 60_000,
    idleCheckMs: 60_000,
    autoDetachMs: GRACE_MS,
    quiet: true,
  });
  baseUrl = `http://127.0.0.1:${daemon.port}`;
});

afterAll(async () => {
  await daemon.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
  delete process.env['PAINTRESS_HOME'];
});

describe('agent 退出后自动退场', () => {
  it('最后一条 attach 断开 → 宽限期内仍在，超时后解绑', async () => {
    await sendRequest({ kind: 'watch', project: 'auto1', dir: projectDir, owner: 'agent' });
    const handle = await attachPersistent('auto1');
    handle.close();

    await sleep(Math.floor(GRACE_MS / 5));
    expect(await names()).toContain('auto1'); // 宽限期：给 agent 重启留活路

    await waitFor(async () => !(await names()).includes('auto1'));
  });

  it('宽限期内重新 attach → 退场被撤销', async () => {
    await sendRequest({ kind: 'watch', project: 'auto2', dir: projectDir, owner: 'agent' });
    const first = await attachPersistent('auto2');
    first.close();

    await sleep(50);
    const second = await attachPersistent('auto2');
    await sleep(GRACE_MS * 2);
    expect(await names()).toContain('auto2');
    second.close();
    await waitFor(async () => !(await names()).includes('auto2'));
  });

  it('浏览器看着时（SSE 打开）永不退场，关掉后才退场', async () => {
    await sendRequest({ kind: 'watch', project: 'auto3', dir: projectDir, owner: 'agent' });
    const handle = await attachPersistent('auto3');

    const controller = new AbortController();
    const sse = await fetch(`${baseUrl}/events?project=auto3&path=design.pen`, { signal: controller.signal });
    expect(sse.headers.get('content-type')).toContain('text/event-stream');

    handle.close();
    await sleep(GRACE_MS * 2);
    expect(await names()).toContain('auto3'); // 有人在看 → 不退场

    controller.abort();
    await waitFor(async () => !(await names()).includes('auto3'));
  });

  it('人手动 watch 的项目不会自动退场', async () => {
    await sendRequest({ kind: 'watch', project: 'manual1', dir: projectDir });
    const handle = await attachPersistent('manual1');
    handle.close();
    await sleep(GRACE_MS * 2);
    expect(await names()).toContain('manual1');
    await sendRequest({ kind: 'unwatch', project: 'manual1' });
  });
});

describe('web 手动解绑', () => {
  it('DELETE /api/projects/:name 缺 x-paintress 头 → 403', async () => {
    await sendRequest({ kind: 'watch', project: 'web1', dir: projectDir });
    const res = await fetch(`${baseUrl}/api/projects/web1`, { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
    expect(await names()).toContain('web1');
  });

  it('带 x-paintress 头 → 解绑，幂等重复调用返回 unwatched=false', async () => {
    await sendRequest({ kind: 'watch', project: 'web2', dir: projectDir });
    const first = await fetch(`${baseUrl}/api/projects/web2`, { method: 'DELETE', headers: { 'x-paintress': '1' } });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { unwatched: boolean }).unwatched).toBe(true);
    expect(await names()).not.toContain('web2');

    const again = await fetch(`${baseUrl}/api/projects/web2`, { method: 'DELETE', headers: { 'x-paintress': '1' } });
    expect(((await again.json()) as { unwatched: boolean }).unwatched).toBe(false);
  });
});

describe('版本探测字段', () => {
  it('未开启 updateCheck 时 latest 为 null（测试/离线不碰网络）', async () => {
    const res = (await (await fetch(`${baseUrl}/api/projects`)).json()) as { version: string; latest: string | null };
    expect(typeof res.version).toBe('string');
    expect(res.latest).toBeNull();
  });
});

describe('关闭 web 进程', () => {
  it('缺头 → 403 且进程仍在', async () => {
    const res = await fetch(`${baseUrl}/api/shutdown`, { method: 'POST' });
    expect(res.status).toBe(403);
    expect(isDaemonRunning()).toBe(true);
  });

  it('带头 → 活跃 agent / 设计稿 SSE / 项目列表 SSE 全部关闭，连接数准确', async () => {
    await sendRequest({ kind: 'watch', project: 'shutdown-live', dir: projectDir });
    const agent = await attachPersistent('shutdown-live');
    let agentClosed = false;
    agent.onClose(() => {
      agentClosed = true;
    });

    const registrySse = await fetch(`${baseUrl}/events`);
    const designSse = await fetch(`${baseUrl}/events?project=shutdown-live&path=design.pen`);
    let registryClosed = false;
    let designClosed = false;
    monitorStreamClose(registrySse, () => {
      registryClosed = true;
    });
    monitorStreamClose(designSse, () => {
      designClosed = true;
    });

    const info = (await (await fetch(`${baseUrl}/api/version`)).json()) as { connections: number };
    expect(info.connections).toBe(3);

    const res = await fetch(`${baseUrl}/api/shutdown`, { method: 'POST', headers: { 'x-paintress': '1' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; shutdown: boolean; connections: number };
    expect(body.ok).toBe(true);
    expect(body.shutdown).toBe(true);
    expect(body.connections).toBe(3);

    await waitFor(async () => agentClosed && registryClosed && designClosed);
    await expect(fetch(`${baseUrl}/api/version`)).rejects.toThrow();
  });
});
