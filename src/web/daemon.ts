import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { VERSION } from '../shared/version.js';
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';
import {
  closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry, type ProjectEntry } from './registry.js';
import { MarksStore } from './marks.js';
import { ChangesStore } from './changes.js';
import { LineDecoder, encodeLine, type ClientRequest, type ServerResponse } from './protocol.js';
import { lockPath, pidPath, safeJoin, socketPath } from './paths.js';
import { WatchManager } from './watcher.js';
import { VersionChecker } from './update-check.js';
import { loadDoc, renderDocument } from '../index.js';


const DEFAULT_PORT = 3316;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

function mimeOf(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** 定位前端产物目录：源码运行 / 构建后 / cwd 三种候选，找不到则回退精简视图 */
function findUiDist(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../ui/dist'), // src/web/daemon.ts（开发/测试）
    resolve(here, '../ui/dist'), // dist/*.js（构建后）
    resolve(process.cwd(), 'ui/dist'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'index.html'))) return c;
  }
  return null;
}

/**
 * 从 URL 路径段里按最长前缀解析项目。
 * 项目 key 现在是目录层级本身（`c-thun/raybend`），所以 `/c-thun/raybend`、
 * `/render/c-thun/raybend/design/editor.pen` 都能在不需要 %2F 转义的情况下命中。
 * 单段名（`paintress watch myname dir`）同样适用。
 */
function resolveProjectPrefix(
  registry: Registry,
  segments: readonly string[],
  maxDepth = 3,
): { entry: ProjectEntry; rest: string[] } | null {
  for (let n = Math.min(maxDepth, segments.length); n >= 1; n--) {
    const key = segments.slice(0, n).map((s) => decodeURIComponent(s)).join('/');
    const entry = registry.get(key);
    if (entry) return { entry, rest: segments.slice(n) };
  }
  return null;
}

export interface DaemonOptions {
  port?: number;
  /**
   * 没有 agent、也没有浏览器、但仍有人手动 watch 的项目时，多久退出（ms），默认 60s。
   * 注意：只要还有 agent attach 或浏览器页面开着，就不会进入 idle。
   */
  idleTimeoutMs?: number;
  /** 无项目、无 agent、无浏览器时的收尾宽限（ms），默认 3s */
  emptyGraceMs?: number;
  /** 浏览器开着但一个项目都没有时，服务端兜底多久退出（ms），默认 30s（正常情况下前端 10s 倒计时会先关） */
  emptyBrowserMs?: number;
  /**
   * 浏览器开着、且本次启动**从未**有过项目（人刚手动 `paintress web`，等 agent 接入）：
   * 服务端兜底多久退出（ms），默认 10 分钟。这条只防「标签页僵尸」，不当催命符。
   */
  manualEmptyMs?: number;
  /** 空闲检查间隔（ms），默认 2s */
  idleCheckMs?: number;
  /**
   * agent 自动注册的项目在连接归零后，宽限多久自动退场（ms），默认 5s。
   * 宽限期用于跨过 agent 崩溃重启的窗口；浏览器看着时不会自动退场。
   */
  autoDetachMs?: number;
  /** 是否向 npm registry 探测新版本（默认关；由 CLI 开启，测试不碰网络） */
  updateCheck?: boolean;
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
      throw new Error(`paintress web 已在运行（pid ${holder}）。如需重启请先 paintress stop`);
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

/**
 * 破坏性写接口的 CSRF 门槛：要求自定义头 `x-paintress: 1`。
 * 跨站 fetch 带自定义头会触发 CORS 预检，而 daemon 从不应答预检 —— 跳站页面发不出该请求。
 * 不做 Origin 白名单：手机经隧道/反代访问时 Origin 是本机看不到的域名，白名单会误伤正常使用。
 */
function isTrustedWrite(req: import('node:http').IncomingMessage): boolean {
  return req.headers['x-paintress'] === '1';
}

export async function startDaemon(opts: DaemonOptions = {}): Promise<DaemonHandle> {
  const releaseLock = acquireLock();
  const registry = new Registry();
  const marks = new MarksStore();
  const changes = new ChangesStore();
  const watchers = new WatchManager();
  const versions = new VersionChecker();
  const startedAt = Date.now();
  const idleTimeoutMs = opts.idleTimeoutMs ?? 60_000;
  // 空仓收尾默认 3s；调用方显式给了更短的 idle 时听它的（否则测试/嵌入场景要白等 3s）
  const emptyGraceMs = opts.emptyGraceMs ?? Math.min(idleTimeoutMs, 3_000);
  const emptyBrowserMs = opts.emptyBrowserMs ?? 30_000;
  const manualEmptyMs = opts.manualEmptyMs ?? 10 * 60_000;
  /** 本次启动有没有过项目：决定「空仓 + 浏览器开着」是等接入还是收工 */
  let everHadProjects = false;
  const idleCheckMs = opts.idleCheckMs ?? 2_000;
  let idleSince: number | null = null;
  let closing = false;
  /** 最近一次 HTTP 活动：用来判定「浏览器还在不在」而不单靠 SSE 关闭事件 */
  let lastHttpAt = Date.now();

  /**
   * 注册表订阅者（浏览器开着的查看器窗口）。
   * 项目列表变化时推 `projects` 事件，避免用户按 F5 才看到新项目。
   */
  const registryClients = new Set<import('node:http').ServerResponse>();
  /** 控制面长连接：shutdown 时必须主动结束，否则 server.close() 会一直等 agent attach */
  const controlClients = new Set<Socket>();
  /** agent attach 总数 / 浏览器连接总数（注册表 SSE + 设计稿 SSE） */
  const agentCount = (): number => registry.all().reduce((n, p) => n + p.agents.size, 0);
  const browserCount = (): number =>
    registryClients.size + registry.all().reduce((n, p) => n + p.browsers.size, 0);
  /** 将被关闭的长连接数：agent attach + 设计稿 SSE + 项目列表 SSE */
  const connectionCount = (): number => registryClients.size + registry.all().reduce((n, p) => n + p.agents.size + p.browsers.size, 0);
  /**
   * 推注册表快照。事件带全量项目信息：前端不用再拉一次接口，项目增删能同一帧完成，
   * 动画也因此不会晚一步。列表很小（每个项目只扫一次 shallow 目录），频繁推不心疼。
   */
  const notifyRegistry = (): void => {
    const payload = JSON.stringify({
      projects: registry.all().map((p) => registry.info(p)),
      agents: agentCount(),
      browsers: browserCount(),
      at: Date.now(),
    });
    for (const res of registryClients) {
      try {
        res.write(`event: projects\ndata: ${payload}\n\n`);
      } catch {
        registryClients.delete(res);
      }
    }
  };

  /**
   * 目录监听：项目目录里新增/删除设计稿时也推 projects 事件，
   * 让「agent 刚创建的文件」在已开着的窗口里自动出现（不靠 F5）。
   * 合并 150ms：一次批量建多个文件只推一次。
   */
  let registryTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleRegistryNotify = (): void => {
    if (registryTimer !== null) return;
    registryTimer = setTimeout(() => {
      registryTimer = null;
      notifyRegistry();
    }, 150);
    registryTimer.unref?.();
  };

  /**
   * agent 自动注册的项目退场：连接归零且无浏览器在看的宽限期后 unwatch。
   * - 宽限期跨过 agent 崩溃重启的窗口（新进程会重新 watch/attach，定时器随即撤销）
   * - 浏览器 SSE 开着时永不退场
   * - 人手动 watch 的项目（owner=manual）不参与自动退场
   */
  const autoDetachMs = opts.autoDetachMs ?? 5_000;
  const autoDetachTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function cancelAutoDetach(name: string): void {
    const timer = autoDetachTimers.get(name);
    if (timer === undefined) return;
    clearTimeout(timer);
    autoDetachTimers.delete(name);
  }

  /** 移除项目并释放目录监听（与 unwatch 同一套收尾），返回是否真的移除了 */
  function detachProject(entry: ProjectEntry, reason: string): boolean {
    cancelAutoDetach(entry.name);
    const removed = registry.remove(entry.name);
    if (!removed) return false;
    if (!registry.all().some((p) => p.rootReal === entry.rootReal)) {
      watchers.unwatchDesigns(entry.rootReal);
    }
    if (!opts.quiet) process.stderr.write(`paintress web: 解绑项目 ${entry.name}（${reason}）\n`);
    notifyRegistry();
    return true;
  }

  function maybeScheduleAutoDetach(name: string): void {
    if (closing) return;
    const entry = registry.get(name);
    if (entry === undefined || entry.owner !== 'agent' || !registry.isIdle(entry)) {
      cancelAutoDetach(name);
      return;
    }
    if (autoDetachTimers.has(name)) return;
    const timer = setTimeout(() => {
      autoDetachTimers.delete(name);
      const current = registry.get(name);
      // 宽限期内可能又有 agent attach、浏览器打开，或被手动 watch 接管
      if (current === undefined || current.owner !== 'agent' || !registry.isIdle(current)) return;
      detachProject(current, 'agent 已退出');
    }, autoDetachMs);
    timer.unref?.();
    autoDetachTimers.set(name, timer);
  }

  /** 控制面：一个连接可同时作为 agent 存活信号 */
  const handleClient = (socket: Socket): void => {
    controlClients.add(socket);
    socket.on('close', () => controlClients.delete(socket));
    const decoder = new LineDecoder();
    let attachToken: { project: string; token: symbol } | null = null;

    const cleanup = (): void => {
      if (!attachToken) return;
      const gone = attachToken.project;
      const entry = registry.get(gone);
      if (entry) entry.agents.delete(attachToken.token);
      attachToken = null;
      // 最后一个 agent 连接断开：自动注册的项目进入宽限退场
      maybeScheduleAutoDetach(gone);
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
              reply({ ok: true, pong: true, pid: process.pid, port, uptimeMs: Date.now() - startedAt, projects: registry.all().length });
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
            case 'watch': {
              everHadProjects = true;
              const entry = registry.watch(req.project, req.dir, req.depth, req.owner === 'agent' ? { owner: 'agent' } : {});
              // 人显式 watch 的项目撤回待执行的自动退场
              cancelAutoDetach(entry.name);
              watchers.watchDesigns(entry.rootReal, entry.depth, scheduleRegistryNotify);
              reply({ ok: true, watched: true, project: registry.info(entry) });
              notifyRegistry();
              break;
            }
            case 'unwatch': {
              const before = registry.get(req.project);
              const removed = before === undefined ? false : detachProject(before, 'unwatch');
              reply({ ok: true, unwatched: removed });
              break;
            }
            case 'attach': {
              const entry = registry.get(req.project);
              if (!entry) throw new Error(`项目未注册：${req.project}`);
              cancelAutoDetach(req.project);
              const token = Symbol(`agent:${req.project}`);
              entry.agents.add(token);
              attachToken = { project: req.project, token };
              reply({ ok: true, attached: true, project: req.project });
              // 让界面立即看到「agent 在位」并撤销倒计时
              notifyRegistry();
              break;
            }
            case 'detach':
              cleanup();
              reply({ ok: true, detached: true, project: req.project });
              break;
            case 'marks':
              reply({ ok: true, marks: marks.list(req.project) });
              break;
            case 'mark':
              reply({
                ok: true,
                mark: marks.add({
                  project: req.project,
                  nodeId: req.nodeId,
                  name: req.name,
                  type: req.type,
                  path: req.path,
                }),
              });
              break;
            case 'clear-marks':
              reply({ ok: true, cleared: marks.clear(req.project) });
              break;
            case 'changes': {
              // req.path 应为绝对路径（调用方已 resolve）。若多个项目根互相包含，取最深根，避免记到外层项目
              const abs = resolve(req.path);
              const candidates = registry
                .all()
                .map((entry) => ({ entry, rel: relative(entry.rootReal, abs) }))
                .filter(
                  (c) =>
                    c.rel !== '' &&
                    c.rel !== '..' &&
                    !c.rel.startsWith('..' + '/') &&
                    !c.rel.startsWith('..' + '\\') &&
                    !c.rel.startsWith('/'),
                )
                .sort((a, b) => b.entry.rootReal.length - a.entry.rootReal.length);
              const hit = candidates[0];
              if (hit) {
                changes.record(hit.entry.name, hit.rel.split(/[\\/]/).join('/'), req.ids);
              }
              reply({ ok: true, recorded: hit ? req.ids.length : 0 });
              break;
            }
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

  const uiDist = findUiDist();

  const httpServer: HttpServer = createHttpServer(async (req, res) => {
    lastHttpAt = Date.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const segments = url.pathname.split('/').filter((s) => s !== '');

    const send = (code: number, body: string, type = 'text/html; charset=utf-8'): void => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    const sendJson = (code: number, payload: unknown): void =>
      send(code, JSON.stringify(payload), 'application/json; charset=utf-8');

    /** 读请求体（仅用于小型 JSON POST） */
    const readBody = async (limit = 64 * 1024): Promise<string> => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const buf = chunk as Buffer;
        size += buf.length;
        if (size > limit) throw new Error(`请求体过大（>${limit} 字节）`);
        chunks.push(buf);
      }
      return Buffer.concat(chunks).toString('utf8');
    };

    try {
      // ---------- JSON API ----------
      if (segments[0] === 'api') {
        if (segments[1] === 'projects' && segments.length === 2) {
          sendJson(200, {
            ok: true,
            pid: process.pid,
            uptimeMs: Date.now() - startedAt,
            version: VERSION,
            // 新版本号（后台探测，本次响应先用上次结果；未开启探测时恒为 null）
            latest: opts.updateCheck === true ? versions.peek() : null,
            connections: connectionCount(),
            projects: registry.all().map((p) => registry.info(p)),
          });
          return;
        }
        // 轻量版本/连接数轮询：不列设计稿，避免定时刷新反复扫描项目目录
        if (segments[1] === 'version' && segments.length === 2) {
          sendJson(200, {
            ok: true,
            pid: process.pid,
            version: VERSION,
            latest: opts.updateCheck === true ? versions.peek() : null,
            connections: connectionCount(),
          });
          return;
        }
        // 解绑项目（查看器项目行的「解绑」）：幂等，已不存在也不算错。
        // 项目 key 可含 `/`：优先按路径前缀命中，退回单段解码
        if (segments[1] === 'projects' && req.method === 'DELETE') {
          if (!isTrustedWrite(req)) {
            sendJson(403, { ok: false, error: '缺少 x-paintress 头' });
            return;
          }
          const name = decodeURIComponent(segments[2] ?? '');
          const entry = registry.get(name);
          sendJson(200, { ok: true, unwatched: entry === undefined ? false : detachProject(entry, 'web 界面解绑') });
          return;
        }
        if (segments[1] === 'projects' && segments[3] === 'files') {
          const name = decodeURIComponent(segments[2] ?? '');
          const entry = registry.get(name);
          if (!entry) {
            sendJson(404, { ok: false, error: `未注册的项目：${name}` });
            return;
          }
          entry.lastAccess = Date.now();
          sendJson(200, { ok: true, project: entry.name, depth: entry.depth, files: registry.listDesigns(entry) });
          return;
        }
        // 关闭 web 进程（查看器侧栏「关闭服务器」）：等响应发完再走已有 shutdown 流程
        if (segments[1] === 'shutdown' && req.method === 'POST') {
          if (!isTrustedWrite(req)) {
            sendJson(403, { ok: false, error: '缺少 x-paintress 头' });
            return;
          }
          res.once('finish', () => {
            setTimeout(() => void shutdown('web 界面关闭'), 0).unref?.();
          });
          sendJson(200, { ok: true, shutdown: true, connections: connectionCount() });
          return;
        }
        if (segments[1] === 'changes') {
          const qProject = url.searchParams.get('project') ?? '';
          const qFile = url.searchParams.get('path') ?? '';
          const set = changes.get(qProject, qFile);
          sendJson(200, { ok: true, ids: set?.ids ?? [], at: set?.at ?? 0 });
          return;
        }
        if (segments[1] === 'marks') {
          const qProject = url.searchParams.get('project') ?? '';
          if (req.method === 'GET') {
            sendJson(200, { ok: true, marks: marks.list(qProject) });
            return;
          }
          if (req.method === 'POST') {
            const raw = await readBody();
            let body: Record<string, unknown>;
            try {
              body = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              sendJson(400, { ok: false, error: '请求体不是合法 JSON' });
              return;
            }
            const projectIn = typeof body['project'] === 'string' ? body['project'] : qProject;
            const nodeId = body['nodeId'];
            if (projectIn === '' || typeof nodeId !== 'string' || nodeId === '') {
              sendJson(400, { ok: false, error: '缺少 project 或 nodeId' });
              return;
            }
            if (!registry.get(projectIn)) {
              sendJson(404, { ok: false, error: `未注册的项目：${projectIn}` });
              return;
            }
            const mark = marks.add({
              project: projectIn,
              nodeId,
              ...(typeof body['name'] === 'string' ? { name: body['name'] } : {}),
              ...(typeof body['type'] === 'string' ? { type: body['type'] } : {}),
              ...(typeof body['path'] === 'string' ? { path: body['path'] } : {}),
            });
            sendJson(200, { ok: true, mark });
            return;
          }
          if (req.method === 'DELETE') {
            const nodeId = url.searchParams.get('nodeId');
            const cleared = nodeId ? (marks.remove(qProject, nodeId) ? 1 : 0) : marks.clear(qProject);
            sendJson(200, { ok: true, cleared });
            return;
          }
          sendJson(405, { ok: false, error: `不支持的方法：${req.method ?? '?'}` });
          return;
        }
        sendJson(404, { ok: false, error: `未知 API：${url.pathname}` });        return;
      }

      // ---------- SSE 热重载 ----------
      if (segments[0] === 'events') {
        const project = url.searchParams.get('project') ?? '';
        const relPath = url.searchParams.get('path') ?? '';

        // 无 project 参数 = 注册表通道：项目增删时推 projects 事件
        if (project === '') {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          });
          res.write(': connected\n\n');
          registryClients.add(res);
          const registryKeepAlive = setInterval(() => res.write(': ping\n\n'), 20_000);
          req.on('close', () => {
            clearInterval(registryKeepAlive);
            registryClients.delete(res);
          });
          return;
        }

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
        // 有人在看：撤销待执行的自动退场
        cancelAutoDetach(entry.name);
        const release = watchers.acquire(abs, () => {
          res.write(`event: change\ndata: ${JSON.stringify({ path: relPath, at: Date.now() })}\n\n`);
        });
        const keepAlive = setInterval(() => res.write(': ping\n\n'), 20_000);
        const done = (): void => {
          clearInterval(keepAlive);
          release();
          entry.browsers.delete(token);
          maybeScheduleAutoDetach(entry.name);
        };
        req.on('close', done);
        return;
      }

      // ---------- 渲染页（iframe 用）----------
      // 两种寻址：`/render/<project>/<relpath>`（project 可含 `/`，按最长前缀命中）
      if (segments[0] === 'render' && segments.length >= 3) {
        const hit = resolveProjectPrefix(registry, segments.slice(1));
        if (hit === null || hit.rest.length === 0) {
          send(404, 'project not found', 'text/plain; charset=utf-8');
          return;
        }
        const { entry } = hit;
        entry.lastAccess = Date.now();
        const relPath = hit.rest.map(decodeURIComponent).join('/');
        const abs = safeJoin(entry.rootReal, relPath);
        if (!abs) {
          send(404, 'file not found', 'text/plain; charset=utf-8');
          return;
        }
        const loaded = loadDoc(abs);
        const rendered = renderDocument(loaded.doc, { title: relPath });
        // base href 让图像填充等相对资源解析到 /files/<project>/<dir>/
        const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/') + 1) : '';
        const baseHref = `/files/${entry.name.split('/').map(encodeURIComponent).join('/')}/${dir
          .split('/')
          .filter((s) => s !== '')
          .map(encodeURIComponent)
          .join('/')}${dir ? '/' : ''}`;
        let html = rendered.html.replace('<head>', `<head>\n<base href="${baseHref}">`);
        // iframe 嵌入（embed=1）时由父页面订阅 SSE；直接访问时恢复自刷新（旧行为）
        if (url.searchParams.get('embed') !== '1') {
          const liveScript = `<script>\n(function(){\n  var es = new EventSource('/events?project=${encodeURIComponent(entry.name)}&path=${encodeURIComponent(relPath)}');\n  es.addEventListener('change', function(){ location.reload(); });\n})();\n</script>`;
          html = html.replace('</body>', `${liveScript}</body>`);
        }
        send(200, html);
        return;
      }

      // ---------- 项目内静态资源（图片、字体等）----------
      if (segments[0] === 'files' && segments.length >= 3) {
        const hit = resolveProjectPrefix(registry, segments.slice(1));
        if (hit === null) {
          send(404, 'project not found', 'text/plain; charset=utf-8');
          return;
        }
        const { entry } = hit;
        const relPath = hit.rest.map(decodeURIComponent).join('/');
        const abs = safeJoin(entry.rootReal, relPath);
        if (!abs) {
          send(404, 'file not found', 'text/plain; charset=utf-8');
          return;
        }
        const buf = await readFile(abs);
        res.writeHead(200, { 'content-type': mimeOf(abs), 'cache-control': 'no-cache' });
        res.end(buf);
        return;
      }

      // ---------- 前端静态产物（ui/dist）----------
      if (uiDist !== null) {
        const rel = segments.map(decodeURIComponent).join('/');
        const candidate = rel === '' ? join(uiDist, 'index.html') : join(uiDist, rel);
        // 目录边界：relative 判定最稳（Windows 分隔符、dist-evil 前缀都不误判）
        const relInside = relative(uiDist, candidate);
        const within = relInside === '' || (!relInside.startsWith('..') && !relInside.startsWith('/') && !relInside.startsWith('\\'));
        if (within && existsSync(candidate) && statSync(candidate).isFile()) {
          const buf = await readFile(candidate);
          res.writeHead(200, { 'content-type': mimeOf(candidate), 'cache-control': 'no-cache' });
          res.end(buf);
          return;
        }
        // SPA 回退：未知路径一律回 index.html
        const index = join(uiDist, 'index.html');
        if (existsSync(index)) {
          const buf = await readFile(index);
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(buf);
          return;
        }
      }

      // ---------- 降级：未构建前端时的内嵌页面 ----------
      if (segments.length === 0) {
        const projects = registry.all();
        const items = projects
          .map((p) => {
            const info = registry.info(p);
            const href = `/${p.name.split('/').map(encodeURIComponent).join('/')}`;
            return `<div class="card"><h2 style="margin:0 0 4px"><a href="${href}">${esc(p.label)}</a></h2><div class="meta">${esc(info.root)} · ${info.fileCount} 个设计稿 · agent ${info.agentConns} · 浏览器 ${info.browserConns}</div></div>`;
          })
          .join('');
        send(
          200,
          layout(
            '项目',
            `<h1>paintress</h1><div class="meta">pid ${process.pid} · 端口 ${opts.port ?? DEFAULT_PORT} · 运行 ${Math.round((Date.now() - startedAt) / 1000)}s</div>` +
              `<p class="meta">前端未构建（<code>ui/dist</code> 不存在），当前为精简视图。</p>` +
              (items || '<p class="empty">还没有注册任何项目。用 <code>paintress watch &lt;name&gt; &lt;dir&gt;</code> 注册。</p>'),
          ),
        );
        return;
      }

      const hit = resolveProjectPrefix(registry, segments);
      if (hit === null) {
        send(404, layout('未找到', `<h1>404</h1><p>未注册的项目：<code>${esc(segments.join('/'))}</code></p><p><a href="/">返回</a></p>`));
        return;
      }
      const { entry } = hit;
      entry.lastAccess = Date.now();

      if (hit.rest.length === 0) {
        const files = registry.listDesigns(entry);
        const list = files
          .map((f) => `<li><a href="/render/${entry.name.split('/').map(encodeURIComponent).join('/')}/${f.split('/').map(encodeURIComponent).join('/')}">${esc(f)}</a></li>`)
          .join('');
        send(
          200,
          layout(
            entry.name,
            `<h1>${esc(entry.name)}</h1><div class="meta">${esc(entry.root)} · depth ${entry.depth}</div>` +
              `<h2>设计稿（${files.length}）</h2>` +
              (files.length ? `<ul>${list}</ul>` : '<p class="empty">目录下没有 .ptr / .pen 文件</p>') +
              '<p><a href="/">← 项目列表</a></p>',
          ),
        );
        return;
      }

      send(404, layout('未找到', '<h1>404</h1><p><a href="/">返回</a></p>'));
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

  /**
   * 生命周期策略：控制权在 agent 侧，人不需要管进程在不在。
   *
   * - 有 agent attach → 永远活着（agent 正在干活）。
   * - 没有 agent，但浏览器开着：
   *     · 还有项目 → 活着；项目归零 → 给前端 10s 倒计时自己走（服务端 emptyBrowserMs 兜底）。
   * - 没有 agent 也没有浏览器：
   *     · 还有手动 watch 的项目 → idleTimeoutMs 后关；
   *     · 一个项目都没有 → 立刻（emptyGraceMs）关。
   *
   * 修的是旧逻辑的真 bug：旧代码只在「项目全部 idle」时计数，自动拉起的 daemon
   * 又写死 `--idle 1h`，于是浏览器早就关了、进程还能挂一小时。
   */
  const idleTimer = setInterval(() => {
    const now = Date.now();
    const projects = registry.all().length;
    const agents = agentCount();
    // 浏览器还“在”的判据：SSE 连接或最近有过 HTTP 请求（标签页冻结/网络断开都会让两者同时失效）
    const browsing = browserCount() > 0 && now - lastHttpAt < 30_000;

    let threshold: number;
    if (agents > 0) {
      idleSince = null;
      changes.prune();
      return;
    }
    if (browsing) {
      if (projects > 0) {
        idleSince = null;
        changes.prune();
        return;
      }
      // 有过项目 → 是收工（前端 10s 倒计时会先关）；从未有过 → 人在等 agent 接入，别催
      threshold = everHadProjects ? emptyBrowserMs : manualEmptyMs;
    } else {
      threshold = projects > 0 ? idleTimeoutMs : emptyGraceMs;
    }

    idleSince = idleSince ?? now;
    if (now - idleSince >= threshold) {
      void shutdown(projects > 0 ? 'idle' : '无项目');
    }
    changes.prune(); // 顺带清理过期变更记录，避免长驻 daemon 下 Map 无限增长
  }, idleCheckMs);
  idleTimer.unref();

  async function shutdown(reason: string): Promise<void> {
    if (closing) return;
    closing = true;
    if (!opts.quiet) process.stderr.write(`paintress web: 退出（${reason}）\n`);
    clearInterval(idleTimer);
    if (registryTimer !== null) clearTimeout(registryTimer);
    for (const timer of autoDetachTimers.values()) clearTimeout(timer);
    autoDetachTimers.clear();
    // 先告诉开着的页面「要关了」，前端才能把状态停留在一个说得通的画面上（而不是网络错误）
    for (const client of registryClients) {
      try {
        client.write(`event: shutdown\ndata: ${JSON.stringify({ reason, at: Date.now() })}\n\n`);
        client.end();
      } catch {
        /* 已断开 */
      }
    }
    registryClients.clear();
    // end() 而非 destroy()：已排队的 shutdown 响应仍会发完，再关闭各 agent attach
    for (const client of controlClients) client.end();
    controlClients.clear();
    await watchers.closeAll();
    await new Promise<void>((resolve) => sockServer.close(() => resolve()));
    // HTTP/2 不适用；HTTP/1 的 SSE 是活跃连接，close() 本身不会结束它们
    const httpClosed = new Promise<void>((resolve) => httpServer.close(() => resolve()));
    httpServer.closeAllConnections();
    await httpClosed;
    releaseLock();
  }

  return { port, pid: process.pid, close: () => shutdown('close'), registry };
}
