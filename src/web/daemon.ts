import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { Registry, DESIGN_EXT } from './registry.js';
import { LineDecoder, encodeLine, type ClientRequest, type ServerResponse } from './protocol.js';
import { lockPath, pidPath, safeJoin, socketPath } from './paths.js';
import { WatchManager } from './watcher.js';
import { loadDoc, renderDocument } from '../index.js';

const VERSION = '0.1.0';
const DEFAULT_PORT = 3316;

export interface DaemonOptions {
  port?: number;
  /** 全部连接断开后多久退出（ms），默认 60s */
  idleTimeoutMs?: number;
  /** 空闲检查间隔（ms），默认 15s */
  idleCheckMs?: number;
  /** 测试用：不写死端口 */
  quiet?: boolean;
}

export interface DaemonHandle {
  port: number;
  pid: number;
  close(): Promise<void>;
  readonly registry: Registry;
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 单实例锁：O_EXCL 原子创建；持锁进程已死则清理重建 */
function acquireLock(): () => void {
  const p = lockPath();
  const tryCreate = (): boolean => {
    try {
      const fd = openSync(p, 'wx', 0o600);
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw cause;
    }
  };
  if (!tryCreate()) {
    let holder = 0;
    try {
      holder = Number(readFileSync(p, 'utf8').trim());
    } catch {
      holder = 0;
    }
    if (isAlive(holder)) {
      throw new Error(`paintress web 已在运行（pid ${holder}）。如需重启请先 paintress web --stop`);
    }
    // 残留锁（持锁进程已死）→ 清理重建
    // 注：PID 复用可能造成误判为「活着」，此时以 socket 探测为准（frame 会连不上而报错）
    try {
      unlinkSync(p);
    } catch {
      /* ignore */
    }
    if (!tryCreate()) throw new Error('无法获取单实例锁（并发启动冲突），请重试');
  }
  writeFileSync(pidPath(), String(process.pid), { mode: 0o600 });
  return () => {
    for (const f of [lockPath(), pidPath(), socketPath()]) {
      try {
        unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  };
}

const PAGE_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1e293b; background: #f8fafc; padding: 24px; }
h1 { font-size: 20px; margin-bottom: 4px; }
h2 { font-size: 16px; margin: 24px 0 12px; }
a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }
.meta { color: #64748b; font-size: 12px; margin-bottom: 20px; }
.card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
ul { list-style: none; }
li { padding: 6px 0; border-bottom: 1px solid #f1f5f9; }
li:last-child { border-bottom: none; }
.empty { color: #94a3b8; font-style: italic; }
code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
`;

function layout(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title} · paintress</title><style>${PAGE_CSS}</style></head><body>${body}</body></html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function startDaemon(opts: DaemonOptions = {}): Promise<DaemonHandle> {
  const releaseLock = acquireLock();
  const registry = new Registry();
  const watchers = new WatchManager();
  const startedAt = Date.now();
  const idleTimeoutMs = opts.idleTimeoutMs ?? 60_000;
  const idleCheckMs = opts.idleCheckMs ?? 15_000;
  let idleSince: number | null = null;
  let closing = false;

  /** 控制面：一个连接可同时作为 agent 存活信号 */
  const handleClient = (socket: Socket): void => {
    const decoder = new LineDecoder();
    let attachToken: { project: string; token: symbol } | null = null;

    const cleanup = (): void => {
      if (!attachToken) return;
      const entry = registry.get(attachToken.project);
      if (entry) entry.agents.delete(attachToken.token);
      attachToken = null;
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);

    const reply = (msg: ServerResponse): void => {
      if (!socket.destroyed) socket.write(encodeLine(msg));
    };

    socket.on('data', (chunk: Buffer) => {
      for (const line of decoder.push(chunk.toString('utf8'))) {
        let req: ClientRequest;
        try {
          req = JSON.parse(line) as ClientRequest;
        } catch {
          reply({ ok: false, error: '请求不是合法 JSON' });
          continue;
        }
        try {
          switch (req.kind) {
            case 'ping':
              reply({ ok: true, pong: true, pid: process.pid, uptimeMs: Date.now() - startedAt, projects: registry.all().length });
              break;
            case 'status':
              reply({
                ok: true,
                pid: process.pid,
                uptimeMs: Date.now() - startedAt,
                projects: registry.all().map((p) => registry.info(p)),
                version: VERSION,
              });
              break;
            case 'watch':
              reply({ ok: true, watched: true, project: registry.info(registry.watch(req.project, req.dir)) });
              break;
            case 'unwatch':
              reply({ ok: true, unwatched: registry.remove(req.project) });
              break;
            case 'attach': {
              const entry = registry.get(req.project);
              if (!entry) throw new Error(`项目未注册：${req.project}`);
              const token = Symbol(`agent:${req.project}`);
              entry.agents.add(token);
              attachToken = { project: req.project, token };
              reply({ ok: true, attached: true, project: req.project });
              break;
            }
            case 'detach':
              cleanup();
              reply({ ok: true, detached: true, project: req.project });
              break;
            case 'shutdown':
              reply({ ok: true, shutdown: true });
              void shutdown('shutdown-request');
              break;
            default:
              reply({ ok: false, error: `未知请求：${String((req as { kind?: string }).kind)}` });
          }
        } catch (cause) {
          reply({ ok: false, error: cause instanceof Error ? cause.message : String(cause) });
        }
      }
    });
  };

  const sockServer: NetServer = createNetServer(handleClient);

  const httpServer: HttpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const segments = url.pathname.split('/').filter((s) => s !== '');

    const send = (code: number, body: string, type = 'text/html; charset=utf-8'): void => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };

    try {
      // 根：项目列表
      if (segments.length === 0) {
        const projects = registry.all();
        const items = projects
          .map((p) => {
            const info = registry.info(p);
            return `<div class="card"><h2 style="margin:0 0 4px"><a href="/${encodeURIComponent(p.name)}">${esc(p.name)}</a></h2><div class="meta">${esc(info.root)} · ${info.fileCount} 个设计稿 · agent ${info.agentConns} · 浏览器 ${info.browserConns}</div></div>`;
          })
          .join('');
        send(200, layout('项目', `<h1>paintress</h1><div class="meta">pid ${process.pid} · 端口 ${opts.port ?? DEFAULT_PORT} · 运行 ${Math.round((Date.now() - startedAt) / 1000)}s</div>${items || '<p class="empty">还没有注册任何项目。用 <code>paintress watch &lt;name&gt; &lt;dir&gt;</code> 注册。</p>'}`));
        return;
      }

      // SSE：/__events?project=&path=
      if (segments[0] === '__events') {
        const project = url.searchParams.get('project') ?? '';
        const relPath = url.searchParams.get('path') ?? '';
        const entry = registry.get(project);
        if (!entry) {
          send(404, 'project not found', 'text/plain; charset=utf-8');
          return;
        }
        const abs = safeJoin(entry.rootReal, relPath);
        if (!abs) {
          send(404, 'file not found', 'text/plain; charset=utf-8');
          return;
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        const token = Symbol('browser');
        entry.browsers.add(token);
        const release = watchers.acquire(abs, () => {
          res.write(`event: change\ndata: ${JSON.stringify({ path: relPath, at: Date.now() })}\n\n`);
        });
        const keepAlive = setInterval(() => res.write(': ping\n\n'), 20_000);
        const done = (): void => {
          clearInterval(keepAlive);
          release();
          entry.browsers.delete(token);
        };
        req.on('close', done);
        return;
      }

      // /{project}[/path]
      const projectName = segments[0] ?? '';
      const entry = registry.get(projectName);
      if (!entry) {
        send(404, layout('未找到', `<h1>404</h1><p>未注册的项目：<code>${esc(projectName)}</code></p><p><a href="/">返回</a></p>`));
        return;
      }
      entry.lastAccess = Date.now();

      // /{project} → 文件列表
      if (segments.length === 1) {
        const files = registry.listDesigns(entry);
        const list = files
          .map((f) => `<li><a href="/${encodeURIComponent(entry.name)}/${f.split('/').map(encodeURIComponent).join('/')}">${esc(f)}</a></li>`)
          .join('');
        send(200, layout(entry.name, `<h1>${esc(entry.name)}</h1><div class="meta">${esc(entry.root)}</div><h2>设计稿（${files.length}）</h2>${files.length ? `<ul>${list}</ul>` : '<p class="empty">目录下没有 .ptr / .pen 文件</p>'}<p><a href="/">← 项目列表</a></p>`));
        return;
      }

      const relPath = segments.slice(1).map(decodeURIComponent).join('/');
      const abs = safeJoin(entry.rootReal, relPath);
      if (!abs) {
        send(404, layout('未找到', `<h1>404</h1><p>文件不存在或路径越界：<code>${esc(relPath)}</code></p><p><a href="/${encodeURIComponent(entry.name)}">返回项目</a></p>`));
        return;
      }

      const ext = extname(abs).toLowerCase();
      if (DESIGN_EXT.has(ext)) {
        const loaded = loadDoc(abs);
        const rendered = renderDocument(loaded.doc, { title: relPath });
        const liveScript = `<script>
(function(){
  var es = new EventSource('/__events?project=${encodeURIComponent(entry.name)}&path=${encodeURIComponent(relPath)}');
  es.addEventListener('change', function(){ location.reload(); });
})();
</script>`;
        send(200, rendered.html.replace('</body>', `${liveScript}</body>`));
        return;
      }

      // 静态资源（图像填充引用的相对路径等）
      const mime: Record<string, string> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.webp': 'image/webp', '.svg': 'image/svg+xml', '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
        '.woff2': 'font/woff2', '.woff': 'font/woff',
      };
      const buf = await readFile(abs);
      res.writeHead(200, { 'content-type': mime[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(buf);
    } catch (cause) {
      send(500, layout('错误', `<h1>500</h1><pre>${esc(cause instanceof Error ? cause.message : String(cause))}</pre>`));
    }
  });

  const desiredPort = opts.port ?? DEFAULT_PORT;
  const port = await new Promise<number>((resolve, reject) => {
    httpServer.once('error', (err) => {
      const e = err as NodeJS.ErrnoException;
      reject(e.code === 'EADDRINUSE' ? new Error(`端口 ${desiredPort} 已被占用；可用 --port 指定其他端口`) : err);
    });
    httpServer.listen(desiredPort, '127.0.0.1', () => {
      const addr = httpServer.address();
      resolve(typeof addr === 'object' && addr !== null ? addr.port : desiredPort);
    });
  });

  const sock = socketPath();
  try {
    if (existsSync(sock)) unlinkSync(sock);
  } catch {
    /* ignore */
  }
  await new Promise<void>((resolve, reject) => {
    sockServer.once('error', reject);
    sockServer.listen(sock, () => {
      resolve();
    });
  });

  const idleTimer = setInterval(() => {
    if (registry.all().length === 0) {
      idleSince = idleSince ?? Date.now();
    } else if (registry.all().every((p) => registry.isIdle(p))) {
      idleSince = idleSince ?? Date.now();
    } else {
      idleSince = null;
      return;
    }
    if (idleSince !== null && Date.now() - idleSince >= idleTimeoutMs) {
      void shutdown('idle');
    }
  }, idleCheckMs);
  idleTimer.unref();

  async function shutdown(reason: string): Promise<void> {
    if (closing) return;
    closing = true;
    if (!opts.quiet) process.stderr.write(`paintress web: 退出（${reason}）\n`);
    clearInterval(idleTimer);
    await watchers.closeAll();
    await new Promise<void>((resolve) => sockServer.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    releaseLock();
  }

  return { port, pid: process.pid, close: () => shutdown('close'), registry };
}
