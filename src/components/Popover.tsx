import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import '../styles/popover.css';

type Props = {
  label: string;
  trigger: ReactNode;
  title: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  className?: string;
  triggerClassName?: string;
  align?: 'start' | 'end';
  disabled?: boolean;
  action?: 'toggle' | 'show';
  onTrigger?: () => void;
};

/** Native top-layer popover: light dismissal, Escape, and invoker focus order. */
export function Popover({ label, trigger, title, children, className = '', triggerClassName, align = 'start', disabled, action = 'toggle', onTrigger }: Props) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  function position() {
    const anchor = button.current?.getBoundingClientRect();
    const node = panel.current;
    if (!anchor || !node) return;
    const margin = 12;
    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const leftEdge = viewport?.offsetLeft ?? 0;
    const topEdge = viewport?.offsetTop ?? 0;
    const panelWidth = Math.min(390, width - margin * 2);
    node.style.width = `${panelWidth}px`;
    node.style.maxHeight = `${Math.max(80, height - margin * 2)}px`;
    const panelHeight = Math.min(node.scrollHeight || 280, height - margin * 2);
    const left = align === 'end' ? anchor.right - panelWidth : anchor.left;
    const top = anchor.bottom + 8 + panelHeight <= topEdge + height - margin ? anchor.bottom + 8 : Math.max(topEdge + margin, anchor.top - panelHeight - 8);
    node.style.left = `${Math.max(leftEdge + margin, Math.min(left, leftEdge + width - panelWidth - margin))}px`;
    node.style.top = `${Math.max(topEdge + margin, Math.min(top, topEdge + height - panelHeight - margin))}px`;
  }

  useEffect(() => {
    if (!open) return;
    const update = (event?: Event) => {
      if (event?.type === 'scroll' && event.target instanceof Node && panel.current?.contains(event.target)) return;
      position();
    };
    const observer = new ResizeObserver(() => position());
    if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [open, align]);

  function close() { panel.current?.hidePopover(); }
  return <>
    <button ref={button} type="button" className={triggerClassName} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} popoverTarget={id} popoverTargetAction={action} disabled={disabled} onClick={() => { onTrigger?.(); position(); }}>{trigger}</button>
    {createPortal(<div ref={panel} id={id} popover="auto" className={`studio-popover ${className}`} role="dialog" aria-labelledby={`${id}-title`} tabIndex={-1} onToggle={event => {
      const shown = event.newState === 'open';
      setOpen(shown);
      if (shown) { position(); panel.current?.focus({ preventScroll: true }); }
    }}>
      <div className="popover-heading"><h3 id={`${id}-title`}>{title}</h3><button type="button" aria-label={`Close ${title}`} onClick={() => { close(); button.current?.focus({ preventScroll: true }); }}>×</button></div>
      {typeof children === 'function' ? children(close) : children}
    </div>, document.body)}
  </>;
}
