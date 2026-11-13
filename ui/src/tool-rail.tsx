import { For, type JSX } from 'solid-js';

/** 画布右上角的浮动纵向工具条（预设 / 组件）。面板由调用方放在它左边 12px 处。 */

export interface RailItem {
  id: string;
  label: string;
  icon: 'preset' | 'component';
}

export interface ToolRailProps {
  items: RailItem[];
  /** 当前展开的面板 id；null = 都没开 */
  active: string | null;
  onToggle: (id: string) => void;
  /** 工具条的 aria-label */
  label: string;
}

const ICON_SIZE = 18;

function PresetIcon(): JSX.Element {
  // 色板：三个圆点 + 外框（lucide 风格，描边用 currentColor）
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8.5" cy="9" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="9" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ComponentIcon(): JSX.Element {
  // 四宫格：tiles 画廊的隐喻
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </svg>
  );
}

export function ToolRail(props: ToolRailProps): JSX.Element {
  return (
    <div class="tool-rail" role="toolbar" aria-label={props.label}>
      <For each={props.items}>
        {(item) => (
          <button
            class="rail-btn"
            classList={{ active: props.active === item.id }}
            title={item.label}
            aria-label={item.label}
            aria-pressed={props.active === item.id}
            onClick={() => props.onToggle(item.id)}
          >
            {item.icon === 'preset' ? <PresetIcon /> : <ComponentIcon />}
          </button>
        )}
      </For>
    </div>
  );
}
