import { createSignal, For, Show, type JSX } from 'solid-js';
import { Panel } from './panel.js';
import type { PresetItem } from './api.js';

/**
 * 项目预设面板：按类型分组，值就地编辑。
 * 改一条就写回 `__preset.ptr`，画布收到 SSE 后重渲染——所以调色是即时的，
 * 不需要一句句跟 agent 说「红一点、再蓝一点」。
 */
export interface PresetPanelLabels {
  title: string;
  close: string;
  empty: string;
  hint: string;
  color: string;
  radius: string;
}

export interface PresetPanelProps {
  items: PresetItem[];
  labels: PresetPanelLabels;
  onClose: () => void;
  /** 提交一条预设的新值；返回的 Promise 结束前输入框保持可编辑（不做乐观更新） */
  onSet: (key: string, value: string) => void;
}

/** `#RGB` / `#RRGGBBAA` → `<input type=color>` 能吃的 `#RRGGBB` */
function toHex6(value: string): string {
  const v = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{6,8}$/.test(v)) return v.slice(0, 7).toUpperCase();
  return '#000000';
}

export function PresetPanel(props: PresetPanelProps): JSX.Element {
  const [draft, setDraft] = createSignal<Record<string, string>>({});

  const valueOf = (item: PresetItem): string => draft()[item.key] ?? item.value;
  const colors = (): PresetItem[] => props.items.filter((p) => p.type === 'color');
  const radii = (): PresetItem[] => props.items.filter((p) => p.type === 'radius');

  function edit(key: string, value: string): void {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function commit(item: PresetItem): void {
    const raw = valueOf(item).trim();
    const clear = (): void => {
      setDraft((prev) => {
        const next = { ...prev };
        delete next[item.key];
        return next;
      });
    };
    if (raw === '' || raw === item.value) {
      clear();
      return;
    }
    props.onSet(item.key, raw);
    clear();
  }

  return (
    <Panel title={props.labels.title} closeLabel={props.labels.close} onClose={props.onClose} floating class="preset-panel">
      <Show
        when={props.items.length > 0}
        fallback={
          <>
            <p class="panel-empty">{props.labels.empty}</p>
            <p class="panel-hint">{props.labels.hint}</p>
          </>
        }
      >
        <Show when={colors().length > 0}>
          <h3 class="panel-group">{props.labels.color}</h3>
          <ul class="preset-list">
            <For each={colors()}>
              {(item) => (
                <li class="preset-row">
                  <span class="preset-name" title={item.key}>
                    {item.name}
                  </span>
                  <input
                    class="preset-swatch"
                    type="color"
                    value={toHex6(valueOf(item))}
                    aria-label={`${item.name} ${props.labels.color}`}
                    onInput={(ev) => edit(item.key, ev.currentTarget.value.toUpperCase())}
                    onChange={(ev) => {
                      edit(item.key, ev.currentTarget.value.toUpperCase());
                      commit(item);
                    }}
                  />
                  <input
                    class="preset-value"
                    type="text"
                    spellcheck={false}
                    value={valueOf(item)}
                    aria-label={`${item.name} ${props.labels.color}`}
                    onInput={(ev) => edit(item.key, ev.currentTarget.value)}
                    onBlur={() => commit(item)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') commit(item);
                      if (ev.key === 'Escape') setDraft({});
                    }}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show when={radii().length > 0}>
          <h3 class="panel-group">{props.labels.radius}</h3>
          <ul class="preset-list">
            <For each={radii()}>
              {(item) => (
                <li class="preset-row">
                  <span class="preset-name" title={item.key}>
                    {item.name}
                  </span>
                  <input
                    class="preset-value"
                    type="number"
                    min="0"
                    step="1"
                    value={valueOf(item)}
                    aria-label={`${item.name} ${props.labels.radius}`}
                    onInput={(ev) => edit(item.key, ev.currentTarget.value)}
                    onBlur={() => commit(item)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') commit(item);
                      if (ev.key === 'Escape') setDraft({});
                    }}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </Panel>
  );
}
