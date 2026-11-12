/**
 * 模态框（二次确认 / 版本提示）。
 *
 * 分两层：`Modal` 只负责壳（遮罩、卡片、标题、Esc/点遮罩关闭、初始焦点），
 * `Confirm` 在它上面拼出「取消 + 危险确认」按钮组。
 * 收在一处的原因：确认按钮必须默认聚焦——手滑点一下就能关掉服务，不给它焦点等于不给后悔的机会。
 */

import { createEffect, Show, type JSX } from 'solid-js';

export interface ModalProps {
  open: boolean;
  title: string;
  children?: JSX.Element;
  /** 底部按钮组；不给就是纯说明弹窗 */
  actions?: JSX.Element;
  onClose: () => void;
  /** 打开后要聚焦的元素（缺省聚焦第一个按钮） */
  initialFocus?: () => HTMLElement | undefined;
}

export function Modal(props: ModalProps) {
  // 打开时聚焦（微任务：等 Show 插入的 DOM 与 ref 赋值都完成）
  createEffect(() => {
    if (!props.open) return;
    queueMicrotask(() => {
      const target = props.initialFocus?.() ?? document.querySelector<HTMLElement>('.modal-actions button');
      target?.focus();
    });
  });

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      props.onClose();
    }
  };

  return (
    <Show when={props.open}>
      <div
        class="modal-backdrop"
        onMouseDown={(ev) => {
          if (ev.target === ev.currentTarget) props.onClose();
        }}
      >
        <div class="modal" role="dialog" aria-modal="true" aria-label={props.title} onKeyDown={onKeyDown}>
          <h3>{props.title}</h3>
          {props.children}
          <Show when={props.actions}>
            <div class="modal-actions">{props.actions}</div>
          </Show>
        </div>
      </div>
    </Show>
  );
}

export interface ConfirmProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Confirm(props: ConfirmProps) {
  let confirmBtn: HTMLButtonElement | undefined;

  return (
    <Modal
      open={props.open}
      title={props.title}
      onClose={props.onCancel}
      initialFocus={() => confirmBtn}
      actions={
        <>
          <button class="ghost" onClick={() => props.onCancel()}>
            {props.cancelLabel}
          </button>
          <button
            class="ghost danger"
            ref={(el) => {
              confirmBtn = el;
            }}
            onClick={() => props.onConfirm()}
          >
            {props.confirmLabel}
          </button>
        </>
      }
    >
      {/* 焦点默认在确认按钮上，Enter 由按钮原生激活（不另写键盘处理） */}
      <p class="modal-body">{props.body}</p>
    </Modal>
  );
}
