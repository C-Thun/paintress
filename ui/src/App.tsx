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

  let frameEl: HTMLIFrameElement | undefined;

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
    const params = new URLSearchParams(location.search);
    void (async () => {
      await loadProjects();
      const p = params.get('project');
      if (p) {
        await openProject(p);
        const f = params.get('file');
        if (f) setActiveFile(f);
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
      '[data-ptr-selected]{outline:2px solid #2563eb !important;outline-offset:-2px;}',
      '[data-ptr-hover]:not([data-ptr-selected]){outline:1px dashed #60a5fa !important;outline-offset:-2px;}',
      '[data-ptr-changed]{box-shadow:inset 0 0 0 2px #f59e0b !important;animation:ptr-pulse 1.4s ease-in-out 3;}',
      '@keyframes ptr-pulse{0%,100%{box-shadow:inset 0 0 0 2px #f59e0b}50%{box-shadow:inset 0 0 0 2px #fde68a}}',
      'html{cursor:default;}',
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

  function onFrameClick(ev: MouseEvent): void {
    const target = ev.target as Element | null;
    const hit = target?.closest('[data-node-id]');
    if (!hit) return;
    ev.preventDefault();
    ev.stopPropagation();
    void selectNode(hit as HTMLElement);
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

  function bindFrame(): void {
    const doc = frameDoc();
    if (!doc) return;
    ensureFrameStyle();
    doc.addEventListener('click', onFrameClick, true);
    doc.addEventListener('mousemove', onFrameMove, true);
    applyHighlight();
    void applyChanges();
  }

  async function selectNode(el: HTMLElement): Promise<void> {
    const nodeId = el.dataset['nodeId'] ?? '';
    if (nodeId === '') return;

    // 祖先链（面包屑）：从命中元素逐层向上
    const chain: Crumb[] = [];
    let cur: Element | null = el;
    while (cur) {
      const nodeEl: Element | null = cur.closest('[data-node-id]');
      if (!nodeEl) break;
      const h = nodeEl as HTMLElement;
      chain.unshift({ id: h.dataset['nodeId'] ?? '', type: h.dataset['nodeType'] ?? '?', name: h.dataset['nodeName'] });
      cur = nodeEl.parentElement;
    }

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
    const el = frameDoc()?.querySelector(`[data-node-id="${cssEscape(id)}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
            <button class="ghost" onClick={() => setReloadKey((n) => n + 1)}>
              重新渲染
            </button>
          </div>
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
