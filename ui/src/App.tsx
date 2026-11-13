import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import {
  addMark,
  clearMarks,
  eventsUrl,
  fetchChanges,
  fetchDaemonInfo,
  fetchFiles,
  fetchMarks,
  fetchProjects,
  registryEventsUrl,
  renderUrl,
  shutdownDaemon,
  unwatchProject,
  type DaemonInfo,
  type Mark,
  type ProjectInfo,
} from './api';
import { Confirm, Modal } from './confirm';
import { isNewer } from '../../src/shared/version-compare.js';
import { bindViewport, type ViewportBinding } from './frame-viewport';
import { FRAME_STYLE } from './frame-style';
import { parseViewport } from './viewport';
import {
  CanvasBgSwitch,
  CANVAS_BG_COLORS,
  initialCanvasBackground,
  rememberCanvasBackground,
  type CanvasBackground,
} from './canvas-bg';
import { initialLang, messages, rememberLang, type Lang } from './i18n';

interface Board {
  id: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Crumb {
  id: string;
  type: string;
  name?: string;
}

/** 项目行：`leaving` 用于退场动画（数据先移除，DOM 多留 220ms） */
interface ProjectRow extends ProjectInfo {
  leaving?: boolean;
}

/** 需要二次确认的破坏性动作（两者都不能手滑就执行） */
type PendingAction = { kind: 'unwatch'; name: string } | { kind: 'shutdown' };

/** 从路径里按最长前缀解析项目（项目 key 带 `/`，如 `c-thun/raybend`） */
function projectFromPath(pathname: string, list: readonly ProjectInfo[]): string | null {
  const segs = pathname.split('/').filter((s) => s !== '');
  for (let n = Math.min(3, segs.length); n >= 1; n--) {
    const key = segs.slice(0, n).map((s) => decodeURIComponent(s)).join('/');
    if (list.some((p) => p.name === key)) return key;
  }
  return null;
}

function projectHref(project: string, file: string | null): string {
  const path = `/${project
    .split('/')
    .filter((s) => s !== '')
    .map(encodeURIComponent)
    .join('/')}`;
  return file === null ? path : `${path}?file=${file.split('/').map(encodeURIComponent).join('/')}`;
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

export default function App() {
  const [projects, setProjects] = createSignal<ProjectInfo[]>([]);
  /** 侧栏渲染用：含 `leaving` 过渡行的版本（数据源仍是 projects） */
  const [rows, setRows] = createSignal<ProjectRow[]>([]);
  const [activeProject, setActiveProject] = createSignal<string | null>(null);
  const [files, setFiles] = createSignal<string[]>([]);
  const [activeFile, setActiveFile] = createSignal<string | null>(null);
  const [marks, setMarks] = createSignal<Mark[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [crumbs, setCrumbs] = createSignal<Crumb[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [daemonInfo, setDaemonInfo] = createSignal<DaemonInfo>({});
  const [reloadKey, setReloadKey] = createSignal(0);
  const [live, setLive] = createSignal(true);
  const [iframeSrc, setIframeSrc] = createSignal('');
  const [boards, setBoards] = createSignal<Board[]>([]);
  const [activeBoard, setActiveBoard] = createSignal<string | null>(null);
  const [zoom, setZoom] = createSignal(1);
  const [lang, setLang] = createSignal<Lang>(initialLang());
  const [canvasBg, setCanvasBg] = createSignal<CanvasBackground>(initialCanvasBackground());
  const [pending, setPending] = createSignal<PendingAction | null>(null);
  const [closed, setClosed] = createSignal(false);
  /** 无激活项目时的关窗倒计时（秒）；null = 不显示遮罩 */
  const [countdown, setCountdown] = createSignal<number | null>(null);
  /** 本次页面会话是否曾经有过项目：有过的项目全消失才是「agent 收工」，才值得弹倒计时 */
  let sawProjects = false;
  const [showUpdate, setShowUpdate] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const m = (): ReturnType<typeof messages> => messages(lang());

  let frameEl: HTMLIFrameElement | undefined;
  let stageEl: HTMLElement | undefined;
  let boardBarEl: HTMLDivElement | undefined;
  let viewportCtl: ViewportBinding | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | undefined;

  /** frame 名超出固定宽度时打标记：右侧 10px 渐隐（不用省略号，渐隐还能看出后面还有字） */
  function markOverflow(el: HTMLElement): void {
    el.classList.toggle('overflow', el.scrollWidth > el.clientWidth + 1);
  }

  function syncUrl(): void {
    const p = activeProject();
    const f = activeFile();
    // 项目 key 本身就带 `/`（c-thun/raybend），地址直接写成路径，不用 ?project= 转义
    history.replaceState(null, '', p === null ? '/' : projectHref(p, f));
  }

  // ---------- 数据加载 ----------
  /**
   * 项目列表 → 侧栏行。新增的行带入场动画；消失的行先标 `leaving`，
   * 220ms 后才真正从 DOM 抽掉。视觉上「项目被 agent 接入 / 收工」自己会说话，
   * 人不需要去点刷新或猜现在绑没绑。
   */
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  function applyProjects(next: ProjectInfo[]): void {
    const prev = rows();
    const prevByName = new Map(prev.map((r) => [r.name, r]));
    const nextKeys = new Set(next.map((p) => p.name));
    const merged: ProjectRow[] = [];
    for (const p of next) {
      const old = prevByName.get(p.name);
      // 引用相同 → <For> 认为这一行没变，不会重建 DOM，也不会重播入场动画
      const unchanged =
        old !== undefined &&
        old.leaving !== true &&
        old.fileCount === p.fileCount &&
        old.agentConns === p.agentConns &&
        old.depth === p.depth &&
        old.label === p.label &&
        old.root === p.root;
      merged.push(unchanged ? old : { ...p });
    }
    let hasLeaving = false;
    for (const old of prev) {
      if (old.leaving === true) {
        if (!nextKeys.has(old.name)) {
          merged.push(old);
          hasLeaving = true;
        }
        continue;
      }
      if (!nextKeys.has(old.name)) {
        merged.push({ ...old, leaving: true });
        hasLeaving = true;
      }
    }
    // 新出现的行排在最前（合并列表时已按 next 顺序在前；`leaving` 行追加在尾）
    setRows(merged);
    if (hasLeaving) {
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => setRows((list) => list.filter((r) => r.leaving !== true)), 240);
    }
    if (next.length > 0) sawProjects = true;
  }

  async function loadProjects(): Promise<void> {
    try {
      const res = await fetchProjects();
      setProjects(res.projects);
      applyProjects(res.projects);
      setDaemonInfo({ pid: res.pid, version: res.version, latest: res.latest ?? null, connections: res.connections });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  /** 后台刷新版本与连接数；本地 daemon 暂时不可达时保持现状，不弹错误 */
  async function refreshDaemonInfo(): Promise<void> {
    try {
      const res = await fetchDaemonInfo();
      setDaemonInfo({ pid: res.pid, version: res.version, latest: res.latest ?? null, connections: res.connections });
    } catch {
      /* 轮询必须静默：npm 或 daemon 暂时不可达都不打扰查看 */
    }
  }

  async function loadMarks(project: string): Promise<void> {
    try {
      setMarks((await fetchMarks(project)).marks);
    } catch {
      setMarks([]);
    }
  }

  async function openProject(name: string): Promise<void> {
    setActiveProject(name);
    setActiveFile(null);
    setSelectedId(null);
    setCrumbs([]);
    try {
      const res = await fetchFiles(name);
      setFiles(res.files);
      setError(null);
    } catch (cause) {
      setFiles([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    void loadMarks(name);
    syncUrl();
  }

  /**
   * 注册表变了（别的窗口 watch/unwatch、或项目目录里新增了设计稿）：
   * 重拉项目与文件列表，不靠用户按 F5。
   */
  async function refreshRegistry(): Promise<void> {
    await loadProjects();
    const p = activeProject();
    if (p === null) return;
    if (!projects().some((x) => x.name === p)) {
      // 当前项目被 unwatch 掉了
      setActiveProject(null);
      setActiveFile(null);
      setFiles([]);
      setSelectedId(null);
      setCrumbs([]);
      syncUrl();
      return;
    }
    try {
      const res = await fetchFiles(p);
      const prev = files();
      setFiles(res.files);
      // 新文件到达：若尚未选中任何设计稿，自动选中新出现的第一个，省一次手点
      const f = activeFile();
      if (f === null) {
        const fresh = res.files.filter((x) => !prev.includes(x));
        if (fresh.length > 0 && projects().some((x) => x.name === p)) openFile(fresh[0] as string);
      } else if (!res.files.includes(f)) {
        // 当前文件被删了
        setActiveFile(null);
        setSelectedId(null);
        setCrumbs([]);
        syncUrl();
      }
    } catch {
      /* 拉不到就保持现状，下一轮事件再试 */
    }
    void loadMarks(p);
  }

  function openFile(file: string): void {
    setActiveFile(file);
    setSelectedId(null);
    setCrumbs([]);
    syncUrl();
  }

  // ---------- 版本升级提示 ----------
  /** 有更新的版本时返回新版号，否则 null（离线 / 未探测 / 已是最新都返回 null） */
  function updateAvailable(): string | null {
    const latest = daemonInfo().latest ?? null;
    const current = daemonInfo().version ?? null;
    if (latest === null || current === null) return null;
    return isNewer(latest, current) ? latest : null;
  }

  async function copyPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(m().updatePrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用（非安全上下文）：文本仍可手动选中复制 */
    }
  }

  // ---------- 破坏性动作：解绑项目 / 关闭 web 进程 ----------
  function askUnwatch(name: string): void {
    setPending({ kind: 'unwatch', name });
  }

  function askShutdown(): void {
    setPending({ kind: 'shutdown' });
    // attach/SSE 的数量变化不推注册表事件，打开确认框时重新取一次准确值
    void refreshDaemonInfo();
  }

  function pendingCopy(): { title: string; body: string; confirm: string } {
    const action = pending();
    if (action === null) return { title: '', body: '', confirm: '' };
    if (action.kind === 'unwatch') {
      return { title: m().unwatchTitle, body: m().unwatchBody(action.name), confirm: m().unwatch };
    }
    return {
      title: m().closeServerTitle,
      body: m().closeServerBody(daemonInfo().pid ?? 0, daemonInfo().connections ?? 0),
      confirm: m().closeServer,
    };
  }

  async function runPending(): Promise<void> {
    const action = pending();
    setPending(null);
    if (action === null) return;
    try {
      if (action.kind === 'unwatch') {
        await unwatchProject(action.name);
        await refreshRegistry();
      } else {
        await shutdownDaemon();
        setClosed(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  onMount(() => {
    // 注册表通道：项目增删 / 目录里新增设计稿 → 列表自动更新（不需要 F5）。
    // 事件里已经带全量项目信息，所以能同一帧把行加/删掉，不必再等一次接口往返。
    const registrySource = new EventSource(registryEventsUrl());
    registrySource.addEventListener('projects', (ev) => {
      const data = (ev as MessageEvent<string>).data;
      let next: ProjectInfo[] | null = null;
      try {
        const parsed = JSON.parse(data) as { projects?: ProjectInfo[] };
        if (Array.isArray(parsed.projects)) next = parsed.projects;
      } catch {
        /* 旧 daemon 只带数量：退回拉一次接口 */
      }
      if (next !== null) {
        setProjects(next);
        applyProjects(next);
        const p = activeProject();
        if (p !== null && !next.some((x) => x.name === p)) {
          // 当前项目已被 agent 收走：退回总页，不在一个死项目上停留
          setActiveProject(null);
          setActiveFile(null);
          setFiles([]);
          setSelectedId(null);
          setCrumbs([]);
          syncUrl();
        } else {
          void refreshRegistry();
        }
      } else {
        void refreshRegistry();
      }
    });
    // daemon 要关了（可能是倒计时结束、也可能是 agent 侧收尾）：把画面停在一个说得通的状态
    registrySource.addEventListener('shutdown', () => {
      setCountdown(null);
      setClosed(true);
    });
    onCleanup(() => registrySource.close());

    // 首次 /api/projects 只启动后台 npm 探测并返回旧值；4s 后再取才能看到结果。
    // 后续轻量轮询让缓存过期后的新版本也能出现，不反复扫描项目目录。
    const versionRetry = setTimeout(() => {
      if (!closed()) void refreshDaemonInfo();
    }, 4000);
    const versionPoll = setInterval(() => {
      if (!closed()) void refreshDaemonInfo();
    }, 60_000);
    onCleanup(() => {
      clearTimeout(versionRetry);
      clearInterval(versionPoll);
    });

    // 焦点在父页面时也要能：空格临时平移、Ctrl+0/Shift+1 视口快捷键
    const isTyping = (ev: KeyboardEvent): boolean => {
      const el = ev.target as HTMLElement | null;
      return el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable === true;
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (isTyping(ev)) return;
      if (ev.key === ' ' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        viewportCtl?.setSpace(true);
        ev.preventDefault();
        return;
      }
      if (viewportCtl?.handleKey(ev) === true) ev.preventDefault();
    };
    const onKeyUp = (ev: KeyboardEvent): void => {
      if (ev.key === ' ') viewportCtl?.setSpace(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    onCleanup(() => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    });

    // frame 列表：滚轮直接横向滚。frame 一多，底下那条细滚动条根本不好抓，
    // 而滚轮是手上已有的动作，不需要额外学。
    const onBoardWheel = (ev: WheelEvent): void => {
      const bar = boardBarEl;
      if (bar === undefined) return;
      const target = ev.target as Node | null;
      if (target === null || !bar.contains(target)) return;
      const delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
      if (delta === 0) return;
      const max = bar.scrollWidth - bar.clientWidth;
      if (max <= 0) return;
      ev.preventDefault();
      bar.scrollLeft = Math.max(0, Math.min(max, bar.scrollLeft + delta));
    };
    window.addEventListener('wheel', onBoardWheel, { passive: false });
    onCleanup(() => window.removeEventListener('wheel', onBoardWheel));

    const params = new URLSearchParams(location.search);
    void (async () => {
      await loadProjects();
      // 新地址：项目写在路径里（`/c-thun/raybend?file=design/editor.pen`）
      // 旧地址：`?project=c-thun-raybend&file=...` 仍然兼容，读进来后回写成新形式
      const fromPath = projectFromPath(location.pathname, projects());
      const legacy = params.get('project');
      const p = fromPath ?? (legacy !== null && projects().some((x) => x.name === legacy) ? legacy : null);
      if (p !== null) {
        await openProject(p);
        const f = params.get('file');
        // 走 openFile 而不是直接 setActiveFile：后者不会回写 URL，
        // 刷新后 file 参数会丢（深链只剩 project）
        if (f) openFile(f);
        else syncUrl();
      }
    })();
  });

  // ---------- 无激活项目 → 10s 倒计时关窗（人不需要自己去关页面/杀进程）----------
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  onCleanup(() => clearInterval(tickTimer));

  function stopCountdown(): void {
    clearInterval(tickTimer);
    tickTimer = undefined;
    setCountdown(null);
  }

  async function shutdownAndLeave(): Promise<void> {
    stopCountdown();
    try {
      await shutdownDaemon();
    } catch {
      /* 已经不可达也算目的达成 */
    }
    setClosed(true);
    // 只有脚本打开的标签才能被关；做不到就留在「服务已关闭」页，不报错（close() 失败不会抛）
    window.close();
  }

  createEffect(
    on(
      () => projects().length,
      (n) => {
        if (closed()) return;
        // 有项目（或被 attach 重新拉进来）→ 撤销倒计时
        if (n > 0) {
          if (countdown() !== null) stopCountdown();
          return;
        }
        // 从没进过项目就不弹（刚手动起 daemon、等 agent 接入的那几秒不该被吓一跳）
        if (!sawProjects) return;
        if (countdown() !== null) return;
        setCountdown(10);
        clearInterval(tickTimer);
        tickTimer = setInterval(() => {
          const left = (countdown() ?? 0) - 1;
          if (left <= 0) {
            stopCountdown();
            void shutdownAndLeave();
            return;
          }
          setCountdown(left);
        }, 1000);
      },
    ),
  );

  // ---------- iframe 内交互（同源访问，无需 allow-scripts）----------
  const frameDoc = (): Document | null => frameEl?.contentDocument ?? null;

  function ensureFrameStyle(): void {
    const doc = frameDoc();
    if (!doc) return;
    if (doc.getElementById('ptr-style')) return;
    const style = doc.createElement('style');
    style.id = 'ptr-style';
    style.textContent = FRAME_STYLE;
    doc.head.appendChild(style);
  }

  function applyHighlight(): void {
    const doc = frameDoc();
    if (!doc) return;
    for (const el of doc.querySelectorAll('[data-ptr-selected]')) el.removeAttribute('data-ptr-selected');
    const id = selectedId();
    if (!id) return;
    doc.querySelector(`[data-node-id="${cssEscape(id)}"]`)?.setAttribute('data-ptr-selected', '');
  }

  /// 上一层：最近的带 data-node-id 的祖先
  function parentNodeElement(el: Element): HTMLElement | null {
    return (el.parentElement?.closest('[data-node-id]') as HTMLElement | null) ?? null;
  }

  /// 下一层：第一个带 data-node-id 的子元素
  function firstChildNodeElement(el: Element): HTMLElement | null {
    return el.querySelector<HTMLElement>(':scope > [data-node-id]');
  }

  function onFrameClick(ev: MouseEvent): void {
    // 拖拽画布结束后紧跟的 click 不能当成选中
    if (viewportCtl?.consumeDragClick() === true) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    const target = ev.target as Element | null;
    const hit = target?.closest('[data-node-id]');
    if (!hit) return;
    ev.preventDefault();
    ev.stopPropagation();
    // Alt+点击：选上一层（已在顶层时选自己）
    const chosen = ev.altKey ? (parentNodeElement(hit) ?? (hit as HTMLElement)) : (hit as HTMLElement);
    void selectNode(chosen);
  }

  /// Alt+滚轮：在祖先链上上/下一级（纯导航，不产生标记）
  function stepLevel(direction: 1 | -1, point: { x: number; y: number }): void {
    const doc = frameDoc();
    if (!doc) return;
    const currentId = selectedId();
    const current =
      currentId === null ? null : doc.querySelector<HTMLElement>(`[data-node-id="${cssEscape(currentId)}"]`);
    if (current === null) {
      // 未选中：先选光标下的最深节点
      const hit = doc.elementFromPoint(point.x, point.y)?.closest('[data-node-id]') as HTMLElement | null;
      const id = hit?.dataset['nodeId'];
      if (id !== undefined) focusNodeById(id);
      return;
    }
    const next = direction === 1 ? parentNodeElement(current) : firstChildNodeElement(current);
    const nextId = next?.dataset['nodeId'];
    if (nextId !== undefined) focusNodeById(nextId);
  }

  function onFrameMove(ev: MouseEvent): void {
    const doc = frameDoc();
    if (!doc) return;
    for (const el of doc.querySelectorAll('[data-ptr-hover]')) el.removeAttribute('data-ptr-hover');
    const hit = (ev.target as Element | null)?.closest('[data-node-id]');
    hit?.setAttribute('data-ptr-hover', '');
  }

  async function applyChanges(): Promise<void> {
    const p = activeProject();
    const f = activeFile();
    if (!p || !f) return;
    try {
      const res = await fetchChanges(p, f);
      // 过期由 daemon 的 TTL 判定（/api/changes 过期即返回空），前端不再叠加第二套阈值
      if (!res.ok || res.ids.length === 0) return;
      const doc = frameDoc();
      if (!doc) return;
      for (const id of res.ids) {
        doc.querySelector(`[data-node-id="${cssEscape(id)}"]`)?.setAttribute('data-ptr-changed', '');
      }
    } catch {
      /* 高亮尽力而为 */
    }
  }

  /**
   * 画板列表：优先用浏览器量出来的真实几何。
   *
   * 自动排版的设计稿（Pencil 里 frame 高度由内容撑开）在文件里根本没有 height，
   * `data-board-*` 会报 0；只有量真实盒子才知道这一页多高，否则「跳到某页」会框到空气。
   */
  function readBoards(): Board[] {
    const doc = frameDoc();
    if (!doc) return [];
    const canvas = doc.querySelector<HTMLElement>('.ptr-canvas');
    const cr = canvas?.getBoundingClientRect();
    const z = viewportCtl?.get().z ?? 1;
    return Array.from(doc.querySelectorAll<HTMLElement>('[data-board]')).map((el) => {
      const d = el.dataset;
      const r = cr === undefined ? null : el.getBoundingClientRect();
      const measured = r !== null && z > 0
        ? { x: (r.left - cr!.left) / z, y: (r.top - cr!.top) / z, w: r.width / z, h: r.height / z }
        : null;
      return {
        id: d['nodeId'] ?? '',
        ...(d['boardName'] === undefined ? {} : { name: d['boardName'] }),
        x: measured?.x ?? Number(d['boardX'] ?? 0),
        y: measured?.y ?? Number(d['boardY'] ?? 0),
        w: measured !== null && measured.w > 0 ? measured.w : Number(d['boardW'] ?? 0),
        h: measured !== null && measured.h > 0 ? measured.h : Number(d['boardH'] ?? 0),
      };
    });
  }

  /// 视口持久化键：按「项目 + 文件」（specs §2.1）
  function viewportKey(): string | null {
    const p = activeProject();
    const f = activeFile();
    return p && f ? `paintress:viewport:${p}/${f}` : null;
  }

  function persistViewport(vp: { z: number; tx: number; ty: number }): void {
    const key = viewportKey();
    if (key === null) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(vp));
      } catch {
        /* 存储不可用时忽略 */
      }
    }, 300);
  }

  function bindFrame(): void {
    const doc = frameDoc();
    if (!doc) return;
    ensureFrameStyle();
    applyCanvasBg();
    viewportCtl?.destroy();
    viewportCtl = bindViewport({
      doc,
      onChange: (vp) => {
        setZoom(vp.z);
        persistViewport(vp);
      },
      onLevelStep: stepLevel,
    });
    setBoards(readBoards());
    setActiveBoard(null);
    restoreViewport();
    doc.addEventListener('click', onFrameClick, true);
    doc.addEventListener('mousemove', onFrameMove, true);
    applyHighlight();
    void applyChanges();
  }

  /// 有持久化则恢复，否则适配整画布
  function restoreViewport(): void {
    if (!viewportCtl) return;
    const key = viewportKey();
    const stored = key === null ? null : localStorage.getItem(key);
    const parsed = stored === null ? null : parseViewport(stored);
    if (parsed !== null) viewportCtl.set(parsed);
    else viewportCtl.fitAll();
  }

  function focusBoard(id: string | null): void {
    setActiveBoard(id);
    if (!viewportCtl) return;
    if (id === null) {
      viewportCtl.fitAll();
      return;
    }
    const b = boards().find((x) => x.id === id);
    if (b) viewportCtl.focusBox({ x: b.x, y: b.y, w: b.w, h: b.h });
  }

  /// 祖先链（面包屑）：从命中元素逐层向上
  function chainOf(el: Element): Crumb[] {
    const chain: Crumb[] = [];
    let cur: Element | null = el;
    while (cur) {
      const nodeEl: Element | null = cur.closest('[data-node-id]');
      if (!nodeEl) break;
      const h = nodeEl as HTMLElement;
      chain.unshift({ id: h.dataset['nodeId'] ?? '', type: h.dataset['nodeType'] ?? '?', name: h.dataset['nodeName'] });
      cur = nodeEl.parentElement;
    }
    return chain;
  }

  async function selectNode(el: HTMLElement): Promise<void> {
    const nodeId = el.dataset['nodeId'] ?? '';
    if (nodeId === '') return;

    const chain = chainOf(el);

    setSelectedId(nodeId);
    setCrumbs(chain);
    applyHighlight();

    const project = activeProject();
    if (!project) return;
    try {
      await addMark({
        project,
        nodeId,
        ...(el.dataset['nodeName'] !== undefined ? { name: el.dataset['nodeName'] } : {}),
        ...(el.dataset['nodeType'] !== undefined ? { type: el.dataset['nodeType'] } : {}),
        path: chain.map((c) => c.name ?? c.type).join(' / '),
      });
      setMarks((await fetchMarks(project)).marks);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function focusNodeById(id: string): void {
    setSelectedId(id);
    applyHighlight();
    const doc = frameDoc();
    const el = doc?.querySelector<HTMLElement>(`[data-node-id="${cssEscape(id)}"]`);
    if (!el || !doc) {
      setCrumbs([]);
      return;
    }
    // 面包屑跟着选中走（点击标记 / Alt+滚轮切换层级都走这里）
    setCrumbs(chainOf(el));
    const canvas = doc.querySelector<HTMLElement>('.ptr-canvas');
    if (!canvas || !viewportCtl) {
      el.scrollIntoView({ block: 'center' });
      return;
    }
    // 两个 rect 同受 transform 影响，差值再除 z 即为画布坐标
    const r = el.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    const z = viewportCtl.get().z;
    viewportCtl.centerOn({
      x: (r.left - c.left) / z,
      y: (r.top - c.top) / z,
      w: r.width / z,
      h: r.height / z,
    });
  }

  async function clearAllMarks(): Promise<void> {
    const project = activeProject();
    if (!project) return;
    try {
      await clearMarks(project);
      setMarks([]);
      setSelectedId(null);
      setCrumbs([]);
      applyHighlight();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  // ---------- 界面语言与画布背景（均写入 localStorage；语言默认跟浏览器）----------
  createEffect(() => {
    const value = lang();
    document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en';
    rememberLang(value);
  });

  /// 画布背景：只改舞台与 iframe 文档底色，不动界面其它区域
  function applyCanvasBg(): void {
    if (stageEl === undefined) return;
    // 没有打开设计稿时不接管舞台底色（保持界面本来的米白）
    if (activeFile() === null) {
      stageEl.style.removeProperty('--canvas-bg');
      stageEl.removeAttribute('data-canvas-bg');
    } else {
      const color = CANVAS_BG_COLORS[canvasBg()];
      stageEl.style.setProperty('--canvas-bg', color);
      stageEl.setAttribute('data-canvas-bg', canvasBg());
    }
    frameDoc()?.documentElement.style.setProperty('--ptr-canvas-bg', CANVAS_BG_COLORS[canvasBg()]);
  }

  createEffect(() => {
    canvasBg();
    rememberCanvasBackground(canvasBg());
    applyCanvasBg();
  });

  // ---------- 预览地址与热重载 ----------
  createEffect(
    on([activeProject, activeFile, reloadKey], () => {
      const p = activeProject();
      const f = activeFile();
      setIframeSrc(p && f ? `${renderUrl(p, f)}&r=${reloadKey()}` : '');
      applyCanvasBg();
    }),
  );

  let source: EventSource | null = null;
  createEffect(
    on([activeProject, activeFile, live], () => {
      source?.close();
      source = null;
      const p = activeProject();
      const f = activeFile();
      if (!live() || !p || !f) return;
      source = new EventSource(eventsUrl(p, f));
      source.addEventListener('change', () => setReloadKey((n) => n + 1));
    }),
  );
  onCleanup(() => source?.close());

  return (
    <div class="app">
      <aside class="sidebar">
        <header class="sidebar-head">
          <img class="brand-mark" src="/logo.svg" alt="" />
          <h1>paintress</h1>
          <Show when={daemonInfo().version}>
            <Show
              when={updateAvailable()}
              fallback={<span class="badge" title={m().versionTitle}>v{daemonInfo().version}</span>}
            >
              <button class="badge badge-stack" title={m().updateTitle} onClick={() => setShowUpdate(true)}>
                <span>v{daemonInfo().version}</span>
                <span class="badge-new">v{updateAvailable()}</span>
              </button>
            </Show>
          </Show>
        </header>

        <section class="section">
          <h2>{m().projects}</h2>
          {/* 用 rows 而不是 projects：项目被收走时数据先空、DOM 还要留 240ms 播退场动画 */}
          <Show
            when={rows().length > 0}
            fallback={
              <p class="empty">
                {m().waitingForAgent}
                <br />
                <code>paintress watch &lt;name&gt; &lt;dir&gt;</code>
              </p>
            }
          >
            <ul class="list">
              <For each={rows()}>
                {(p) => (
                  <li class="row" classList={{ leaving: p.leaving === true }}>
                    <button class="item" classList={{ active: activeProject() === p.name }} onClick={() => void openProject(p.name)}>
                      <span class="item-name">{p.label ?? p.name}</span>
                      <span class="item-meta">
                        {m().projectFiles(p.fileCount)}
                        {p.agentConns > 0 ? <span class="dot" title={m().agentOnline} /> : null}
                      </span>
                    </button>
                    <button class="row-action" title={m().unwatch} aria-label={`${m().unwatch} ${p.name}`} onClick={() => askUnwatch(p.name)}>
                      ×
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        <Show when={activeProject()}>
          <section class="section files">
            <h2>
              {m().designs}{' '}
              <span class="hint">
                {m().depth} {projects().find((p) => p.name === activeProject())?.depth ?? '-'}
              </span>
            </h2>
            <Show when={files().length > 0} fallback={<p class="empty">{m().noFiles}</p>}>
              <ul class="list">
                <For each={files()}>
                  {(f) => (
                    <li>
                      <button class="item" classList={{ active: activeFile() === f }} onClick={() => openFile(f)}>
                        <span class="item-name">{f}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </section>
        </Show>

        <Show when={marks().length > 0}>
          <section class="section marks">
            <h2>
              {m().marks}
              <button class="ghost tiny" onClick={() => void clearAllMarks()}>
                {m().clear}
              </button>
            </h2>
            <ul class="list">
              <For each={marks()}>
                {(m) => (
                  <li>
                    <button class="item" classList={{ active: selectedId() === m.nodeId }} onClick={() => focusNodeById(m.nodeId)}>
                      <span class="item-name">
                        <b class="mark-no">#{m.shortId}</b> {m.name ?? m.nodeId}
                      </span>
                      <span class="item-meta">{m.path}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>

        <footer class="sidebar-foot">
          <label class="toggle">
            <input type="checkbox" checked={live()} onChange={(e) => setLive(e.currentTarget.checked)} />
            {m().liveReload}
          </label>
          <button class="ghost" onClick={() => void loadProjects()}>
            {m().refreshList}
          </button>
          <button class="ghost" onClick={() => askShutdown()}>
            {m().closeServer}
          </button>
          <Show when={daemonInfo().pid}>
            <span class="hint">pid {daemonInfo().pid}</span>
          </Show>
        </footer>
      </aside>

      <main class="stage" ref={(el) => { stageEl = el; }}>
        <Show when={error()}>
          <div class="error">{error()}</div>
        </Show>
        <div class="toolbar">
          <div class="crumbs">
            <Show when={crumbs().length === 0} fallback={
              <For each={crumbs()}>
                {(c, i) => (
                  <>
                    <Show when={i() > 0}>
                      <span class="sep">/</span>
                    </Show>
                    <button class="crumb" classList={{ active: selectedId() === c.id }} onClick={() => focusNodeById(c.id)}>
                      {c.name ?? c.type}
                    </button>
                  </>
                )}
              </For>
            }>
              <Show when={activeProject() !== null && activeFile() !== null}>
                <code>{projects().find((p) => p.name === activeProject())?.label ?? activeProject()}</code>
                <span class="sep">/</span>
                <code>{activeFile()}</code>
              </Show>
            </Show>
          </div>
          <div class="tools">
            <Show when={activeProject() !== null && activeFile() !== null}>
              <span class="hint zoom">{Math.round(zoom() * 100)}%</span>
              <button class="ghost tiny" title={m().fitTitle} onClick={() => viewportCtl?.fitAll()}>
                {m().fit}
              </button>
              <button class="ghost tiny" title={m().actualSizeTitle} onClick={() => viewportCtl?.zoomToPercent(1)}>
                {m().actualSize}
              </button>
              <button class="ghost" onClick={() => setReloadKey((n) => n + 1)}>
                {m().rerender}
              </button>
              <span class="tool-sep" />
            </Show>
            <CanvasBgSwitch value={canvasBg()} onChange={setCanvasBg} label={m().canvasBackground} />
            <div class="lang-switch" role="group" aria-label={m().language} title={m().language}>
              <button class="lang-opt" classList={{ active: lang() === 'zh' }} onClick={() => setLang('zh')} aria-pressed={lang() === 'zh'}>
                中
              </button>
              <button class="lang-opt" classList={{ active: lang() === 'en' }} onClick={() => setLang('en')} aria-pressed={lang() === 'en'}>
                EN
              </button>
            </div>
          </div>
        </div>
        <Show
          when={activeProject() !== null && activeFile() !== null}
          fallback={
            <div class="placeholder">
              <Show when={activeProject()} fallback={<p>{m().pickProject}</p>}>
                <p>{m().pickFile}</p>
              </Show>
            </div>
          }
        >
          <Show when={boards().length > 1}>
            <div class="boardbar">
              {/* 「全部」不参与滚动：横向翻到后面几个画板时，回看整张画布仍然是一次点击 */}
              <button class="board" classList={{ active: activeBoard() === null }} onClick={() => focusBoard(null)}>
                {m().allBoards}
              </button>
              <div
                class="boardbar-scroll"
                ref={(el) => {
                  boardBarEl = el;
                }}
              >
                <For each={boards()}>
                {(b) => (
                  <button class="board" classList={{ active: activeBoard() === b.id }} onClick={() => focusBoard(b.id)}>
                    <span
                      class="board-name"
                      ref={(el) => queueMicrotask(() => markOverflow(el))}
                    >
                      {b.name ?? `#${b.id}`}
                    </span>
                    <span class="board-size">
                      {Math.round(b.w)}×{Math.round(b.h)}
                    </span>
                  </button>
                )}
                </For>
              </div>
            </div>
          </Show>
          <iframe
            ref={(el) => {
              frameEl = el;
            }}
            class="preview"
            title="design preview"
            sandbox="allow-same-origin allow-scripts"
            src={iframeSrc()}
            onLoad={bindFrame}
          />
        </Show>
      </main>

      <Confirm
        open={pending() !== null}
        title={pendingCopy().title}
        body={pendingCopy().body}
        confirmLabel={pendingCopy().confirm}
        cancelLabel={m().cancel}
        onConfirm={() => void runPending()}
        onCancel={() => setPending(null)}
      />

      <Show when={closed()}>
        <div class="modal-backdrop">
          <div class="modal" role="status">
            <h3>{m().serverClosed}</h3>
            <p class="modal-body">{m().serverClosedHint}</p>
          </div>
        </div>
      </Show>

      {/* 无激活项目：10s 倒计时遮罩（agent 重启接入会自动撤销，人不用管） */}
      <Show when={countdown() !== null && !closed()}>
        <div class="modal-backdrop countdown-backdrop">
          <div class="modal countdown" role="alertdialog" aria-live="polite">
            <h3>{m().noActiveProjects}</h3>
            <p class="modal-body">{m().closingIn(countdown() ?? 0)}</p>
            <div class="countdown-track" aria-hidden="true">
              <span class="countdown-fill" style={{ '--left': `${((countdown() ?? 0) / 10) * 100}%` }} />
            </div>
          </div>
        </div>
      </Show>

      <Modal
        open={showUpdate()}
        title={m().updateTitle}
        onClose={() => setShowUpdate(false)}
        actions={
          <>
            <a class="ghost" href="https://github.com/aliciai-dev/paintress" target="_blank" rel="noreferrer">
              {m().updateRepo}
            </a>
            <button class="ghost" onClick={() => setShowUpdate(false)}>
              {m().close}
            </button>
          </>
        }
      >
        <p class="modal-body">
          {m().updateAvailable(updateAvailable() ?? '', daemonInfo().version ?? '')}
        </p>
        <pre class="prompt">{m().updatePrompt}</pre>
        <button class="ghost tiny" onClick={() => void copyPrompt()}>
          {copied() ? m().copied : m().copy}
        </button>
        <p class="modal-body">{m().updateSteps}</p>
      </Modal>
    </div>
  );
}
