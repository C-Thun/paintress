import { For, Show, type JSX } from 'solid-js';
import { Panel } from './panel.js';
import { componentRenderUrl, type ComponentItem } from './api.js';

/**
 * 组件画廊：只读。每个组件一个固定尺寸正方形 tile，名称在下方——
 * 人一眼能看出 agent 已经做了多少组件、都长什么样。
 * tile 里的 iframe 按组件包围盒等比缩小（不拉伸、不留白边错位）。
 */
export interface ComponentGalleryLabels {
  title: string;
  close: string;
  empty: string;
  hint: string;
  count: (count: number) => string;
}

export interface ComponentGalleryProps {
  items: ComponentItem[];
  project: string;
  labels: ComponentGalleryLabels;
  onClose: () => void;
}

/** tile 外框边长与内边距（px） */
const TILE = 148;
const INSET = 14;

function Tile(props: { item: ComponentItem; project: string }): JSX.Element {
  const w = (): number => Math.max(1, props.item.width ?? 120);
  const h = (): number => Math.max(1, props.item.height ?? 40);
  // 只缩不放：小组件保持原尺寸，大组件等比塞进 tile
  const scale = (): number => Math.min(1, (TILE - INSET * 2) / Math.max(w(), h()));
  return (
    <figure class="tile">
      <div class="tile-frame">
        <iframe
          src={componentRenderUrl(props.project, props.item.id)}
          title={props.item.name}
          loading="lazy"
          scrolling="no"
          sandbox="allow-same-origin"
          style={{
            width: `${w()}px`,
            height: `${h()}px`,
            transform: `translate(-50%, -50%) scale(${scale()})`,
          }}
        />
      </div>
      <figcaption title={props.item.name}>{props.item.name}</figcaption>
    </figure>
  );
}

export function ComponentGallery(props: ComponentGalleryProps): JSX.Element {
  return (
    <Panel title={props.labels.title} closeLabel={props.labels.close} onClose={props.onClose} floating class="components-panel">
      <Show
        when={props.items.length > 0}
        fallback={
          <>
            <p class="panel-empty">{props.labels.empty}</p>
            <p class="panel-hint">{props.labels.hint}</p>
          </>
        }
      >
        <p class="panel-hint">{props.labels.count(props.items.length)}</p>
        <div class="tiles">
          <For each={props.items}>{(item) => <Tile item={item} project={props.project} />}</For>
        </div>
      </Show>
    </Panel>
  );
}
