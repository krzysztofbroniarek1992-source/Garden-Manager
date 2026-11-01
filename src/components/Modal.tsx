import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './modal.css';

const modalStack: HTMLElement[] = [];
let previousBodyOverflow = '';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  fullScreen?: boolean;
  active?: boolean;
}

export default function Modal({ title, onClose, children, wide, fullScreen=false, active=true }: ModalProps) {
  const headingId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const scroll = useRef(0);
  close.current = onClose;

  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const element = panel.current!;
    if (!modalStack.length) previousBodyOverflow = document.body.style.overflow;
    modalStack.push(element);
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex="0"]',
    ) ?? []).filter(element => element.getClientRects().length > 0);
    const initial = focusable().find(element => element.tagName !== 'BUTTON') ?? focusable()[0];
    initial?.focus({preventScroll:true});
    element.scrollTop=scroll.current;
    const handleKey = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== element) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        panel.current?.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      scroll.current=element.scrollTop;
      document.removeEventListener('keydown', handleKey);
      const index = modalStack.indexOf(element);
      if (index >= 0) modalStack.splice(index, 1);
      if (!modalStack.length) document.body.style.overflow = previousBodyOverflow;
      if (previous?.isConnected && previous.getClientRects().length) previous.focus({preventScroll:true});
    };
  }, [active]);

  return createPortal(
    <div hidden={!active} inert={!active} className={`gm-modal-backdrop${fullScreen?' gm-fullscreen-backdrop':''}`} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`gm-modal${wide ? ' gm-modal-wide' : ''}${fullScreen?' gm-modal-fullscreen':''}`} ref={panel} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}>
        <div className="gm-modal-heading">
          <div><span className="eyebrow">GARDEN MANAGER</span><h2 id={headingId}>{title}</h2></div>
          <button className="icon-button" type="button" aria-label="Zamknij okno" onClick={onClose}><X size={21} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
