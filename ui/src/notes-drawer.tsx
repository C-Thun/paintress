import { createEffect, createSignal, onCleanup, on, Show, type JSX } from 'solid-js';
import { Panel } from './panel.js';
import { renderMarkdown } from './markdown.js';

/**
 * 设计稿笔记抽屉：占布局的固定宽面板（画布随之收窄），内容是同名 `.md`。
 * 只读——写入走普通文件工具，paintress 不开写路径。
 */
export interface NotesDrawerProps {
  title: string;
  closeLabel: string;
  /** 当前笔记正文；null = 还没取到 / 没有笔记 */
  markdown: string | null;
  /** 取笔记失败时的错误文案 */
  error: string | null;
  onClose: () => void;
}

export function NotesDrawer(props: NotesDrawerProps): JSX.Element {
  const [html, setHtml] = createSignal('');
  const [failed, setFailed] = createSignal<string | null>(null);

  createEffect(
    on(
      () => props.markdown,
      (src) => {
        if (src === null) {
          setHtml('');
          setFailed(null);
          return;
        }
        let stale = false;
        void renderMarkdown(src)
          .then((out) => {
            if (stale) return;
            setHtml(out);
            setFailed(null);
          })
          .catch((cause: unknown) => {
            if (stale) return;
            setFailed(cause instanceof Error ? cause.message : String(cause));
          });
        onCleanup(() => {
          stale = true;
        });
      },
    ),
  );

  return (
    <Panel title={props.title} closeLabel={props.closeLabel} onClose={props.onClose} class="notes-panel">
      <Show when={failed() ?? props.error} fallback={<div class="markdown" innerHTML={html()} />}>
        {(message) => <p class="panel-error">{message()}</p>}
      </Show>
    </Panel>
  );
}
