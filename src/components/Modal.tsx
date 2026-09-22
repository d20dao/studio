import { useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import '../styles/modal.css';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** A committed operation is running; prevent dismissal until its result is available. */
  busy?: boolean;
};

/** Shared native modal. Mark a safe footer action with data-modal-initial-focus. */
export function Modal({ open, onClose, title, children, footer, className = '', busy = false }: ModalProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const pointerStartedOutside = useRef(false);

  useLayoutEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body;
    const overflow = body.style.getPropertyValue('overflow');
    const overflowPriority = body.style.getPropertyPriority('overflow');
    const padding = body.style.getPropertyValue('padding-right');
    const paddingPriority = body.style.getPropertyPriority('padding-right');
    const gutter = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const currentPadding = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
    node.showModal();
    body.style.setProperty('overflow', 'hidden');
    if (gutter) body.style.setProperty('padding-right', `${currentPadding + gutter}px`);
    const safeAction = node.querySelector<HTMLElement>('[data-modal-initial-focus]:not(:disabled)');
    (safeAction ?? closeButton.current)?.focus({ preventScroll: true });

    return () => {
      if (node.open) node.close();
      if (overflow) body.style.setProperty('overflow', overflow, overflowPriority);
      else body.style.removeProperty('overflow');
      if (padding) body.style.setProperty('padding-right', padding, paddingPriority);
      else body.style.removeProperty('padding-right');
      // A confirmed deletion can remove the original trigger; preserve a useful keyboard destination.
      const target = invoker?.isConnected && !invoker.matches(':disabled') ? invoker : document.getElementById('main');
      target?.focus({ preventScroll: true });
      pointerStartedOutside.current = false;
    };
  }, [open]);

  function requestClose() { if (!busy) onClose(); }
  function outside(clientX: number, clientY: number) {
    const bounds = dialog.current?.getBoundingClientRect();
    return !!bounds && (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom);
  }

  return createPortal(<dialog
    ref={dialog}
    className={`studio-modal ${className}`}
    aria-labelledby={`${id}-title`}
    aria-describedby={`${id}-body`}
    aria-busy={busy || undefined}
    onCancel={event => { event.preventDefault(); requestClose(); }}
    onClose={() => { if (open && !dialog.current?.open) requestClose(); }}
    onPointerDown={event => { pointerStartedOutside.current = event.target === event.currentTarget && outside(event.clientX, event.clientY); }}
    onClick={event => {
      if (pointerStartedOutside.current && event.target === event.currentTarget && outside(event.clientX, event.clientY)) requestClose();
      pointerStartedOutside.current = false;
    }}
  >
    <div className="modal-heading"><h2 id={`${id}-title`}>{title}</h2><button ref={closeButton} type="button" className="modal-close" aria-label={`Close ${title}`} disabled={busy} onClick={requestClose}>×</button></div>
    <div className="modal-body" id={`${id}-body`}>{children}</div>
    {footer && <div className="modal-footer">{footer}</div>}
  </dialog>, document.body);
}
