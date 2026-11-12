import { createSignal, onCleanup, onMount } from 'solid-js';
import { positionFromPointer } from './canvas-bg-math';

/** 画布背景三档：只影响画布区（舞台 + iframe 文档底色），不动界面其它部分 */
export const CANVAS_BACKGROUNDS = ['light', 'gray', 'dark'] as const;
export type CanvasBackground = (typeof CANVAS_BACKGROUNDS)[number];

/** 名称固定英文（operator 2026-11-12：左边文字显示当前样式名称，英文就行） */
const NAMES: Record<CanvasBackground, string> = { light: 'Light', gray: 'Gray', dark: 'Dark' };

export const CANVAS_BG_COLORS: Record<CanvasBackground, string> = {
  light: '#ffffff',
  gray: '#d2cec7',
  // 不用纯黑：与米白界面反差过大；微亮微蓝的深蓝灰（operator 2026-11-12 定）
  dark: '#242b36',
};

const STORAGE_KEY = 'paintress:canvas-bg';

export function isCanvasBackground(value: unknown): value is CanvasBackground {
  return CANVAS_BACKGROUNDS.includes(value as CanvasBackground);
}

export function initialCanvasBackground(): CanvasBackground {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isCanvasBackground(stored)) return stored;
  } catch {
    /* 存储不可用时忽略 */
  }
  return 'light';
}

export function rememberCanvasBackground(value: CanvasBackground): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* 存储不可用时忽略 */
  }
}

/** 轨道内边距与滑块直径（px）；同时传给 CSS 变量，保证 JS 指针换算与视觉一致 */
const PAD = 3;
const THUMB = 20;

interface CanvasBgSwitchProps {
  value: CanvasBackground;
  onChange: (value: CanvasBackground) => void;
  label: string;
}

/**
 * 凹陷凹槽横条 + 圆形滑块，左中右三档；支持点击与拖动。
 * 无障碍：role="slider"，左右方向键切换。
 */
export function CanvasBgSwitch(props: CanvasBgSwitchProps) {
  const [dragging, setDragging] = createSignal(false);
  const [dragPos, setDragPos] = createSignal<number | null>(null);
  const [step, setStep] = createSignal(29);
  let trackEl: HTMLDivElement | undefined;

  const index = (): number => CANVAS_BACKGROUNDS.indexOf(props.value);
  const pos = (): number => dragPos() ?? index();

  // 行程 = 轨道宽 - 两侧内边距 - 滑块直径；用实测宽度算，避免与 CSS 硬编码打架
  onMount(() => {
    const measure = (): void => {
      const el = trackEl;
      if (!el) return;
      const travel = el.getBoundingClientRect().width - PAD * 2 - THUMB;
      setStep(travel / (CANVAS_BACKGROUNDS.length - 1));
    };
    measure();
    if (typeof ResizeObserver === 'undefined' || !trackEl) return;
    const ro = new ResizeObserver(measure);
    ro.observe(trackEl);
    onCleanup(() => ro.disconnect());
  });

  function posFromPointer(ev: PointerEvent): number {
    const el = trackEl;
    if (!el) return index();
    const rect = el.getBoundingClientRect();
    const position = positionFromPointer({
      clientX: ev.clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
      pad: PAD,
      thumb: THUMB,
      count: CANVAS_BACKGROUNDS.length,
    });
    return position ?? index();
  }

  function commit(p: number): void {
    const next = CANVAS_BACKGROUNDS[Math.round(p)];
    if (next !== undefined && next !== props.value) props.onChange(next);
  }

  function onPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    setDragging(true);
    setDragPos(posFromPointer(ev));
  }

  function onPointerMove(ev: PointerEvent): void {
    if (!dragging()) return;
    setDragPos(posFromPointer(ev));
  }

  function onPointerUp(ev: PointerEvent): void {
    if (!dragging()) return;
    const target = ev.currentTarget as HTMLElement;
    setDragging(false);
    setDragPos(null);
    commit(posFromPointer(ev));
    if (target.hasPointerCapture(ev.pointerId)) target.releasePointerCapture(ev.pointerId);
  }

  function cancelDrag(): void {
    setDragging(false);
    setDragPos(null);
  }

  function onKeyDown(ev: KeyboardEvent): void {
    const step = ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowDown' ? -1 : 0;
    if (step === 0) return;
    ev.preventDefault();
    const next = CANVAS_BACKGROUNDS[Math.max(0, Math.min(CANVAS_BACKGROUNDS.length - 1, index() + step))];
    if (next !== undefined) props.onChange(next);
  }

  return (
    <div class="canvas-bg">
      <span class="canvas-bg-label">{NAMES[props.value]}</span>
      <div
        ref={trackEl}
        class="canvas-bg-track"
        classList={{ dragging: dragging() }}
        role="slider"
        tabindex="0"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={CANVAS_BACKGROUNDS.length - 1}
        aria-valuenow={index()}
        aria-valuetext={NAMES[props.value]}
        title={props.label}
        style={{ '--pad': `${PAD}px`, '--thumb': `${THUMB}px`, '--step': `${step()}px`, '--pos': String(pos()) }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
        onKeyDown={onKeyDown}
      >
        <div class="canvas-bg-thumb" aria-hidden="true">
          <span class="canvas-bg-dot" style={{ '--dot': CANVAS_BG_COLORS[props.value] }} />
        </div>
      </div>
    </div>
  );
}
