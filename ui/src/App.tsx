import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import {
  addMark,
  clearMarks,
  eventsUrl,
  fetchChanges,
  fetchFiles,
  fetchMarks,
  fetchProjects,
  renderUrl,
  type Mark,
  type ProjectInfo,
} from './api';
import { bindViewport, type ViewportBinding } from './frame-viewport';
import { parseViewport } from './viewport';

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

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

export default function App() {
  const [projects, setProjects] = createSignal<ProjectInfo[]>([]);
  const [activeProject, setActiveProject] = createSignal<string | null>(null);
  const [files, setFiles] = createSignal<string[]>([]);
  const [activeFile, setActiveFile] = createSignal<string | null>(null);
  const [marks, setMarks] = createSignal<Mark[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [crumbs, setCrumbs] = createSignal<Crumb[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [daemonInfo, setDaemonInfo] = createSignal<{ pid?: number; version?: string }>({});
  const [reloadKey, setReloadKey] = createSignal(0);
  const [live, setLive] = createSignal(true);
  const [iframeSrc, setIframeSrc] = createSignal('');
  const [boards, setBoards] = createSignal<Board[]>([]);
  const [activeBoard, setActiveBoard] = createSignal<string | null>(null);
  const [zoom, setZoom] = createSignal(1);

  let frameEl: HTMLIFrameElement | undefined;
  let viewportCtl: ViewportBinding | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | undefined;

  function syncUrl(): void {
    const params = new URLSearchParams();
    const p = activeProject();
    const f = activeFile();
    if (p) params.set('project', p);
    if (f) params.set('file', f);
    const qs = params.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }

  // ---------- 数据加载 ----------
  async function loadProjects(): Promise<void> {
    try {
      const res = await fetchProjects();
      setProjects(res.projects);
      setDaemonInfo({ pid: res.pid, version: res.version });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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

  function openFile(file: string): void {
    setActiveFile(file);
    setSelectedId(null);
    setCrumbs([]);
    syncUrl();
  }

  onMount(() => {
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

    const params = new URLSearchParams(location.search);
    void (async () => {
      await loadProjects();
      const p = params.get('project');
      if (p) {
        await openProject(p);
        const f = params.get('file');
        // 走 openFile 而不是直接 setActiveFile：后者不会回写 URL，
        // 刷新后 file 参数会丢（深链只剩 project）
        if (f) openFile(f);
      }
    })();
  });

  // ---------- iframe 内交互（同源访问，无需 allow-scripts）----------
  const frameDoc = (): Document | null => frameEl?.contentDocument ?? null;

  function ensureFrameStyle(): void {
    const doc = frameDoc();
    if (!doc) return;
    if (doc.getElementById('ptr-style')) return;
    const style = doc.createElement('style');
    style.id = 'ptr-style';
    style.textContent = [
      '[data-ptr-selected]{outline:2px solid #908030 !important;outline-offset:-2px;}',
      '[data-ptr-hover]:not([data-ptr-selected]){outline:1px dashed rgba(144,128,48,.55) !important;outline-offset:-2px;}',
      '[data-ptr-changed]{box-shadow:inset 0 0 0 2px #908030 !important;animation:ptr-pulse 1.4s ease-in-out 3;}',
      '@keyframes ptr-pulse{0%,100%{box-shadow:inset 0 0 0 2px #908030}50%{box-shadow:inset 0 0 0 2px rgba(144,128,48,.35)}}',
      'html{cursor:default;}',
      'html,body{overflow:hidden;}',
    ].join('\n');
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

  function readBoards(): Board[] {
    const doc = frameDoc();
    if (!doc) return [];
    return Array.from(doc.querySelectorAll<HTMLElement>('[data-board]')).map((el) => {
      const d = el.dataset;
      return {
        id: d['nodeId'] ?? '',
        ...(d['boardName'] === undefined ? {} : { name: d['boardName'] }),
        x: Number(d['boardX'] ?? 0),
        y: Number(d['boardY'] ?? 0),
        w: Number(d['boardW'] ?? 0),
        h: Number(d['boardH'] ?? 0),
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

  // ---------- 预览地址与热重载 ----------
  createEffect(
    on([activeProject, activeFile, reloadKey], () => {
      const p = activeProject();
      const f = activeFile();
      setIframeSrc(p && f ? `${renderUrl(p, f)}&r=${reloadKey()}` : '');
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
            <span class="badge">v{daemonInfo().version}</span>
          </Show>
        </header>

        <section class="section">
          <h2>项目</h2>
          <Show
            when={projects().length > 0}
            fallback={
              <p class="empty">
                还没有注册项目
                <br />
                <code>paintress watch &lt;name&gt; &lt;dir&gt;</code>
              </p>
            }
          >
            <ul class="list">
              <For each={projects()}>
                {(p) => (
                  <li>
                    <button class="item" classList={{ active: activeProject() === p.name }} onClick={() => void openProject(p.name)}>
                      <span class="item-name">{p.name}</span>
                      <span class="item-meta">{p.fileCount} 个设计稿</span>
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
              设计稿 <span class="hint">depth {projects().find((p) => p.name === activeProject())?.depth ?? '-'}</span>
            </h2>
            <Show when={files().length > 0} fallback={<p class="empty">没有 .ptr / .pen 文件</p>}>
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
              标记
              <button class="ghost tiny" onClick={() => void clearAllMarks()}>
                清空
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
            实时刷新
          </label>
          <button class="ghost" onClick={() => void loadProjects()}>
            刷新列表
          </button>
          <Show when={daemonInfo().pid}>
            <span class="hint">pid {daemonInfo().pid}</span>
          </Show>
        </footer>
      </aside>

      <main class="stage">
        <Show when={error()}>
          <div class="error">{error()}</div>
        </Show>
        <Show
          when={activeProject() !== null && activeFile() !== null}
          fallback={
            <div class="placeholder">
              <Show when={activeProject()} fallback={<p>从左侧选择项目</p>}>
                <p>从左侧选择一个设计稿</p>
              </Show>
            </div>
          }
        >
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
                <code>
                  {activeProject()}/{activeFile()}
                </code>
              </Show>
            </div>
            <div class="tools">
              <span class="hint zoom">{Math.round(zoom() * 100)}%</span>
              <button class="ghost tiny" title="适应窗口（Shift+1）" onClick={() => viewportCtl?.fitAll()}>
                适应
              </button>
              <button class="ghost tiny" title="100%（Ctrl/Cmd+0）" onClick={() => viewportCtl?.zoomToPercent(1)}>
                1:1
              </button>
              <button class="ghost" onClick={() => setReloadKey((n) => n + 1)}>
                重新渲染
              </button>
            </div>
          </div>
          <Show when={boards().length > 1}>
            <div class="boardbar">
              <button class="board" classList={{ active: activeBoard() === null }} onClick={() => focusBoard(null)}>
                全部
              </button>
              <For each={boards()}>
                {(b) => (
                  <button class="board" classList={{ active: activeBoard() === b.id }} onClick={() => focusBoard(b.id)}>
                    {b.name ?? `#${b.id}`}
                    <span class="board-size">
                      {Math.round(b.w)}×{Math.round(b.h)}
                    </span>
                  </button>
                )}
              </For>
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
    </div>
  );
}
