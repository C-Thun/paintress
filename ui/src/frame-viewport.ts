/**
 * 把视口控制器绑到 iframe 文档上（specs/canvas-interaction.md §2.1）。
 *
 * 约束：iframe 同源（`sandbox="allow-same-origin allow-scripts"`），因此直接操作
 * contentDocument；变换只作用在 `.ptr-canvas` 上，不回写渲染结果。
 */
import {
  fitBox,
  panBy,
  transformCss,
  zoomAt,
  zoomTo,
  type Box,
  type Size,
  type Viewport,
} from './viewport';

/** 位移小于此值视为点击，否则视为拖拽（specs §2.4） */
const DRAG_THRESHOLD = 3;
/** 滚轮灵敏度：deltaY 每 1 单位约 0.15% 的指数缩放 */
const WHEEL_SENSITIVITY = 0.0015;

export interface ViewportBinding {
  get(): Viewport;
  set(vp: Viewport): void;
  /** 适配整个画布 */
  fitAll(): void;
  /** 聚焦某个盒（画板 / 节点包围盒），保持当前倍率并居中 */
  centerOn(box: Box): void;
  /** 把某个盒适配进视口（画板聚焦：平移 + 缩放） */
  focusBox(box: Box): void;
  /** 缩放到指定倍率，锚点 = 视口中心 */
  zoomToPercent(z: number): void;
  /** 拖拽结束后吞掉紧随其后的那次点击（否则拖画布会误选中节点） */
  consumeDragClick(): boolean;
  /** 键盘处理；返回 true 表示已消费 */
  handleKey(ev: KeyboardEvent): boolean;
  /** 空格按下态：父窗口与 iframe 焦点在不同 document，需由调用方转发 */
  setSpace(down: boolean): void;
  destroy(): void;
}

export interface BindOptions {
  doc: Document;
  /** 视口变化时回调（持久化用） */
  onChange?: (vp: Viewport) => void;
}

export function bindViewport({ doc, onChange }: BindOptions): ViewportBinding | null {
  const found = doc.querySelector<HTMLElement>('.ptr-canvas');
  if (found === null) return null;
  // 显式标注为非空：闭包里不再享受控制流收窄
  const canvas: HTMLElement = found;
  canvas.style.transformOrigin = '0 0';

  let vp: Viewport = { z: 1, tx: 0, ty: 0 };
  let spaceDown = false;
  let dragging = false;
  let suppressClick = false;
  let pending: { lastX: number; lastY: number; startX: number; startY: number } | null = null;

  const viewportSize = (): Size => ({
    width: doc.documentElement.clientWidth || 1,
    height: doc.documentElement.clientHeight || 1,
  });

  function paint(): void {
    canvas.style.transform = transformCss(vp);
    onChange?.(vp);
  }

  function set(next: Viewport): void {
    vp = next;
    paint();
  }

  /** 手动交互时立刻打断聚焦动画，避免拖拽与过渡互相拉扯 */
  function stopTransition(): void {
    canvas.style.transition = '';
  }

  /** 平滑过渡到目标视口（点击画板聚焦用） */
  function animate(next: Viewport): void {
    canvas.style.transition = 'transform 180ms ease-out';
    set(next);
    setTimeout(stopTransition, 220);
  }

  function setCursor(cursor: string): void {
    doc.documentElement.style.cursor = cursor;
  }

  // ---------- 缩放 ----------
  function onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    stopTransition();
    // 统一成像素增量：不同浏览器 deltaMode 不同，这里只处理 line/page 的近似换算
    let unit = 1;
    if (ev.deltaMode === 1) unit = 16; // 行模式：按一行 16px 近似
    else if (ev.deltaMode === 2) unit = viewportSize().height; // 页模式
    set(zoomAt(vp, Math.exp(-ev.deltaY * unit * WHEEL_SENSITIVITY), ev.clientX, ev.clientY));
  }

  // ---------- 平移 ----------
  function canPan(ev: MouseEvent): boolean {
    if (ev.button === 1) return true; // 中键
    if (ev.button !== 0) return false;
    if (spaceDown) return true;
    // 空白区：画布本身或 body/html（节点会冒泡到画布，但 target 是节点元素）
    return ev.target === canvas || ev.target === doc.body || ev.target === doc.documentElement;
  }

  function onMouseDown(ev: MouseEvent): void {
    if (!canPan(ev)) return;
    ev.preventDefault(); // 阻止中键自动滚动与文本选择
    pending = { lastX: ev.clientX, lastY: ev.clientY, startX: ev.clientX, startY: ev.clientY };
    dragging = false;
  }

  function onMouseMove(ev: MouseEvent): void {
    if (!pending) return;
    if (!dragging) {
      const moved = Math.hypot(ev.clientX - pending.startX, ev.clientY - pending.startY);
      if (moved < DRAG_THRESHOLD) return;
      dragging = true;
      stopTransition();
      doc.body.style.userSelect = 'none';
      setCursor('grabbing');
    }
    const dx = ev.clientX - pending.lastX;
    const dy = ev.clientY - pending.lastY;
    pending.lastX = ev.clientX;
    pending.lastY = ev.clientY;
    set(panBy(vp, dx, dy));
  }

  function onMouseUp(): void {
    if (!pending) return;
    pending = null;
    if (dragging) {
      dragging = false;
      suppressClick = true;
      doc.body.style.userSelect = '';
      setCursor(spaceDown ? 'grab' : '');
    }
  }

  // ---------- 键盘 ----------
  function setSpace(down: boolean): void {
    if (spaceDown === down) return;
    spaceDown = down;
    if (!dragging) setCursor(down ? 'grab' : '');
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.key === ' ' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      const target = ev.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true) return;
      setSpace(true);
      ev.preventDefault();
      return;
    }
    if (handleKey(ev)) ev.preventDefault();
  }

  function onKeyUp(ev: KeyboardEvent): void {
    if (ev.key === ' ') setSpace(false);
  }

  function onBlur(): void {
    setSpace(false);
    onMouseUp();
  }

  /** Ctrl/Cmd+0 → 100%；Shift+1 → fit（specs §2.1 交互表） */
  function handleKey(ev: KeyboardEvent): boolean {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === '0' || ev.key === ')' || ev.code === 'Digit0' || ev.code === 'Numpad0')) {
      set(zoomTo(vp, 1, viewportSize()));
      return true;
    }
    if (ev.shiftKey && !ev.ctrlKey && !ev.metaKey && (ev.key === '!' || ev.code === 'Digit1')) {
      fitAll();
      return true;
    }
    return false;
  }

  function fitAll(): void {
    set(fitBox({ x: 0, y: 0, w: canvas.offsetWidth, h: canvas.offsetHeight }, viewportSize()));
  }

  function centerOn(box: Box): void {
    const size = viewportSize();
    animate({
      z: vp.z,
      tx: size.width / 2 - (box.x + box.w / 2) * vp.z,
      ty: size.height / 2 - (box.y + box.h / 2) * vp.z,
    });
  }

  doc.addEventListener('wheel', onWheel, { passive: false });
  doc.addEventListener('mousedown', onMouseDown, true);
  doc.addEventListener('mousemove', onMouseMove, true);
  doc.addEventListener('mouseup', onMouseUp, true);
  doc.addEventListener('keydown', onKeyDown);
  doc.addEventListener('keyup', onKeyUp);
  doc.defaultView?.addEventListener('blur', onBlur);

  return {
    get: () => vp,
    set,
    fitAll,
    centerOn,
    focusBox: (box) => animate(fitBox(box, viewportSize())),
    zoomToPercent: (z) => set(zoomTo(vp, z, viewportSize())),
    consumeDragClick: () => {
      const was = suppressClick;
      suppressClick = false;
      return was;
    },
    handleKey,
    setSpace,
    destroy: () => {
      doc.removeEventListener('wheel', onWheel);
      doc.removeEventListener('mousedown', onMouseDown, true);
      doc.removeEventListener('mousemove', onMouseMove, true);
      doc.removeEventListener('mouseup', onMouseUp, true);
      doc.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('keyup', onKeyUp);
      doc.defaultView?.removeEventListener('blur', onBlur);
    },
  };
}
