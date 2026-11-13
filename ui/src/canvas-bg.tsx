
/** 画布背景三档：只影响画布区（舞台 + iframe 文档底色），不动界面其它部分 */
export const CANVAS_BACKGROUNDS = ['light', 'gray', 'dark'] as const;
export type CanvasBackground = (typeof CANVAS_BACKGROUNDS)[number];

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

/** 三档名称固定英文（operator 2026-11-12：显示当前样式名称，英文就行） */
const NAMES: Record<CanvasBackground, string> = { light: 'Light', gray: 'Gray', dark: 'Dark' };

interface CanvasBgSwitchProps {
  value: CanvasBackground;
  onChange: (value: CanvasBackground) => void;
  label: string;
}

/**
 * 画布背景三档切换：扁平分段控件。
 *
 * 2026-11-13 由「凹槽 + 圆滑块」改成现在的样子：那套拟物视觉与侧栏、工具条上
 * 的 ghost 按钮不是同一套语言，放在一起显得突兀。三档各带一个色点，
 * 不用点开就知道是哪三档。
 *
 * 无障碍：一组 `aria-pressed` 按钮，Tab 可达，读屏能报出当前档位。
 */
export function CanvasBgSwitch(props: CanvasBgSwitchProps) {
  return (
    <div class="canvas-bg" role="group" aria-label={props.label} title={props.label}>
      {CANVAS_BACKGROUNDS.map((value) => (
        <button
          type="button"
          class="canvas-bg-opt"
          classList={{ active: props.value === value }}
          aria-pressed={props.value === value}
          onClick={() => props.onChange(value)}
        >
          <span class="canvas-bg-dot" style={{ '--dot': CANVAS_BG_COLORS[value] }} aria-hidden="true" />
          {NAMES[value]}
        </button>
      ))}
    </div>
  );
}
