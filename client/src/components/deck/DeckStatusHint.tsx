import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { getPresentationPortalRoot } from '@/lib/appPresentation';

/** Compact deck metadata with the same explanation for mouse, keyboard and touch. */
export function DeckStatusHint({
  label,
  children,
  details,
  className = '',
  onClick,
  menuOpen,
}: {
  label: string;
  children: ReactNode;
  details: ReactNode;
  className?: string;
  onClick?: () => void;
  menuOpen?: boolean;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  const focused = useRef(false);
  const [open, setOpen] = useState(false);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const show = () => {
    cancelClose();
    setOpen(true);
  };
  const close = useCallback(() => {
    cancelClose();
    pinned.current = false;
    setOpen(false);
  }, [cancelClose]);
  const leave = () => {
    cancelClose();
    if (!pinned.current && !focused.current) {
      closeTimer.current = setTimeout(() => setOpen(false), 120);
    }
  };

  useEffect(() => () => cancelClose(), [cancelClose]);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      if (!trigger || !tooltip) return;
      const anchor = trigger.getBoundingClientRect();
      const box = tooltip.getBoundingClientRect();
      tooltip.style.left = `${Math.max(12, Math.min(anchor.right - box.width, window.innerWidth - box.width - 12))}px`;
      tooltip.style.top = `${
        anchor.bottom + 6 + box.height <= window.innerHeight - 12
          ? anchor.bottom + 6
          : Math.max(12, anchor.top - box.height - 6)
      }px`;
      tooltip.style.visibility = 'visible';
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, details]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !tooltipRef.current?.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-haspopup={onClick ? 'menu' : undefined}
        aria-expanded={onClick ? menuOpen : open}
        className={`inline-flex min-h-7 min-w-7 items-center justify-center gap-1 rounded-[var(--radius-sm)] px-1 text-xs leading-5 transition-colors hover:bg-[var(--bg-elevated)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] ${className}`}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') show();
        }}
        onPointerLeave={leave}
        onFocus={() => {
          focused.current = true;
          show();
        }}
        onBlur={() => {
          focused.current = false;
          close();
        }}
        onClick={() => {
          if (onClick) {
            close();
            onClick();
          } else if (pinned.current) {
            close();
          } else {
            pinned.current = true;
            show();
          }
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            id={id}
            role="tooltip"
            onPointerEnter={cancelClose}
            onPointerLeave={leave}
            className="fixed z-[220] w-max max-w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)] shadow-md"
            style={{ visibility: 'hidden', maxHeight: 'calc(100dvh - 1.5rem)' }}
          >
            {details}
          </div>,
          getPresentationPortalRoot()
        )}
    </>
  );
}
