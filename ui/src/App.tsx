import { createEffect, createSignal, For, on, onMount, Show } from 'solid-js';
import { fetchFiles, fetchProjects, renderUrl, eventsUrl, type ProjectInfo } from './api';

export default function App() {
  const [projects, setProjects] = createSignal<ProjectInfo[]>([]);
  const [activeProject, setActiveProject] = createSignal<string | null>(null);
  const [files, setFiles] = createSignal<string[]>([]);
  const [activeFile, setActiveFile] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [daemonInfo, setDaemonInfo] = createSignal<{ pid?: number; version?: string }>({});
  const [reloadKey, setReloadKey] = createSignal(0);
  const [live, setLive] = createSignal(true);
  const [iframeSrc, setIframeSrc] = createSignal('');

  function syncUrl(): void {
    const params = new URLSearchParams();
    const p = activeProject();
    const f = activeFile();
    if (p) params.set('project', p);
    if (f) params.set('file', f);
    const qs = params.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }

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

  async function openProject(name: string): Promise<void> {
    setActiveProject(name);
    setActiveFile(null);
    try {
      const res = await fetchFiles(name);
      setFiles(res.files);
      setError(null);
    } catch (cause) {
      setFiles([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    syncUrl();
  }

  function openFile(file: string): void {
    setActiveFile(file);
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

  /** 预览地址：reloadKey 变化 → query 变化 → iframe 重载 */
  createEffect(
    on([activeProject, activeFile, reloadKey], () => {
      const p = activeProject();
      const f = activeFile();
      setIframeSrc(p && f ? `${renderUrl(p, f)}?r=${reloadKey()}` : '');
    }),
  );

  /** 热重载订阅：选择变化或开关切换时重连 SSE */
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
            <code>
              {activeProject()}/{activeFile()}
            </code>
            <button class="ghost" onClick={() => setReloadKey((n) => n + 1)}>
              重新渲染
            </button>
          </div>
          <iframe class="preview" title="design preview" src={iframeSrc()} />
        </Show>
      </main>
    </div>
  );
}
