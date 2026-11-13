import type { JSX } from 'solid-js';

/**
 * 通用侧面板壳：圆角卡片 + 标题 + 右上角关闭。
 * 笔记抽屉（占布局，画布左侧）、预设/组件面板（浮动，画布右侧）共用同一个壳，
 * 位置与宽度由调用方决定（壳不关心自己在哪）。
 */
export interface PanelProps {
  title: string;
  /** 关闭按钮的无障碍文案（i18n 由调用方给） */
  closeLabel: string;
  onClose: () => void;
  /** 浮动面板（带滑出动画、脱离布局）；笔记抽屉不浮动 */
  floating?: boolean;
  class?: string;
  children: JSX.Element;
}

export function Panel(props: PanelProps): JSX.Element {
  const cls = (): string =>
    ['panel', props.floating === true ? 'panel-float' : '', props.class ?? ''].filter((s) => s !== '').join(' ');
  return (
    <aside class={cls()}>
      <header class="panel-head">
        <h2>{props.title}</h2>
        <button class="ghost tiny panel-close" title={props.closeLabel} aria-label={props.closeLabel} onClick={props.onClose}>
          ✕
        </button>
      </header>
      <div class="panel-body">{props.children}</div>
    </aside>
  );
}
